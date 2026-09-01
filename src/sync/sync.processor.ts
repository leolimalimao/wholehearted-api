import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpotifyService } from '../spotify/spotify.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';
import { User } from '../auth/entities/user.entity';

export const SYNC_QUEUE = 'sync';

@Processor(SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private spotifyService: SpotifyService,
    @InjectRepository(Scrobble) private scrobbleRepo: Repository<Scrobble>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super();
  }

  async process(_job: Job) {
    // multi-tenant: virá como job.data.userId
    const user = await this.userRepo.findOne({ where: {} });
    if (!user) {
      this.logger.warn('Nenhum usuário encontrado — pulando sync.');
      return;
    }

    const userId = user.id;
    this.logger.log(`Iniciando sync para usuário ${userId}...`);

    // busca o scrobble mais recente desse usuário específico
    const latest = await this.scrobbleRepo.findOne({
      where: { userId },
      order: { playedAt: 'DESC' },
    });

    const afterCursor = latest
      ? new Date(latest.playedAt).getTime()
      : undefined;

    const data = await this.spotifyService.getRecentlyPlayed(50, afterCursor);

    if (!data?.items?.length) {
      this.logger.log('Nenhuma música nova encontrada.');
      return;
    }

    let inserted = 0;

    for (const item of data.items) {
      const playedAt = new Date(item.played_at);

      const exists = await this.scrobbleRepo.findOne({
        where: {
          userId,
          trackSpotifyId: item.track.id,
          playedAt,
        },
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
  }
}