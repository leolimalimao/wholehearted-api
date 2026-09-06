import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpotifyService } from '../spotify/spotify.service';
import { CacheService } from '../common/cache/cache.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';
import { User } from '../auth/entities/user.entity';

export const SYNC_QUEUE = 'sync';

@Processor(SYNC_QUEUE, {
  stalledInterval: 300000,  // heartbeat a cada 5 minutos
  maxStalledCount: 1,
  concurrency: 1,
})
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private spotifyService: SpotifyService,
    @InjectRepository(Scrobble) private scrobbleRepo: Repository<Scrobble>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private cache: CacheService,
  ) {
    super();
  }

  async process(job: Job<{ userId: string }>) {
    const userId = job.data?.userId;

    if (!userId) {
      this.logger.warn('Job sem userId no payload — ignorando.');
      return;
    }

    // busca o usuário pra ter o refresh_token disponível pro SpotifyService
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`Usuário ...${userId.slice(-4)} não encontrado — ignorando.`);
      return;
    }

    this.logger.log(`Iniciando sync para usuário ...${userId.slice(-4)}`);

    const latest = await this.scrobbleRepo.findOne({
      where: { userId },
      order: { playedAt: 'DESC' },
    });

    const afterCursor = latest
      ? new Date(latest.playedAt).getTime()
      : undefined;

    const data = await this.spotifyService.getRecentlyPlayed(
      userId,
      50,
      afterCursor,
    );

    if (!data?.items?.length) {
      this.logger.log('Nenhuma música nova encontrada.');
      return;
    }

    let inserted = 0;

    for (const item of data.items) {
      const playedAt = new Date(item.played_at);

      const exists = await this.scrobbleRepo.findOne({
        where: { userId, trackSpotifyId: item.track.id, playedAt },
      });

      if (exists) continue;

      await this.scrobbleRepo.save(
        this.scrobbleRepo.create({
          userId,
          trackSpotifyId: item.track.id,
          trackName: item.track.name,
          artistName: item.track.artists[0]?.name ?? 'Desconhecido',
          albumName: item.track.album.name,
          albumImageUrl: item.track.album.images[0]?.url ?? null,
          playedAt,
        }),
      );

      inserted++;
    }

    this.logger.log(`Sync concluído. ${inserted} scrobble(s) inserido(s).`);

    if (inserted > 0) {
      // invalida todas as keys públicas desse usuário
      // próxima request reconstrói com dados frescos
      await this.cache.invalidatePattern(`public:profile:${user.slug}`);
      await this.cache.invalidatePattern(`public:overview:${user.slug}`);
      await this.cache.invalidatePattern(`public:recent:${user.slug}`);
      await this.cache.invalidatePattern(`public:hours:${user.slug}`);
      this.logger.log(`Cache invalidado para ${user.slug}`);
    }
    
    this.logger.log(`Sync concluído. ${inserted} scrobble(s) inserido(s).`);
  }
}