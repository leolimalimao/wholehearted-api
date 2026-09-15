import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { SpotifyService } from '../spotify/spotify.service';
import { CacheService } from '../common/cache/cache.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';
import { User } from '../auth/entities/user.entity';

export const SYNC_QUEUE = 'sync';

@Processor(SYNC_QUEUE, {
  stalledInterval: 30000,   // verificação de jobs travados a cada 30 segundos (detecção ágil em caso de crash)
  maxStalledCount: 1,
  concurrency: 1,
  drainDelay: 5,            // 5 segundos padrão quando a fila estiver drenada
  lockDuration: 30000,      // lock de 30s por job
})
export class SyncProcessor extends WorkerHost {
  constructor(
    private spotifyService: SpotifyService,
    @InjectRepository(Scrobble) private scrobbleRepo: Repository<Scrobble>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private cache: CacheService,
    @InjectPinoLogger(SyncProcessor.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<{ userId: string }>) {
    const startTime = Date.now();
    const userId = job.data?.userId;
    const jobId = job.id;

    if (!userId) {
      this.logger.warn({ jobId }, 'Job sem userId no payload — ignorando.');
      return;
    }

    const maskedUser = `...${userId.slice(-4)}`;

    try {
      // busca o usuário para ter o slug disponível para invalidação de cache e verificar avatar
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: { id: true, slug: true, avatarUrl: true },
      });
      if (!user) {
        this.logger.warn({ jobId, userId: maskedUser }, `Usuário ${maskedUser} não encontrado — ignorando.`);
        return;
      }

      // Lazy backfill: resgata foto do perfil do Spotify caso o usuário ainda não possua avatarUrl registrado
      if (user.avatarUrl === null || user.avatarUrl === undefined) {
        try {
          const profile = await this.spotifyService.getUserProfile(userId);
          const avatarUrl = profile?.images?.[0]?.url ?? null;
          await this.userRepo.update(userId, { avatarUrl });
          user.avatarUrl = avatarUrl;
          await this.cache.invalidatePattern(`public:profile:${user.slug}`);
          this.logger.info(
            { userId: maskedUser, hasAvatar: !!avatarUrl },
            `Lazy backfill: avatar sincronizado para usuário ${maskedUser}`,
          );
        } catch (profileErr: any) {
          this.logger.warn(
            { err: profileErr, userId: maskedUser },
            `Falha não-bloqueante no lazy backfill de avatar para ${maskedUser}`,
          );
        }
      }

      this.logger.info({ jobId, userId: maskedUser }, `Iniciando sync para usuário ${maskedUser}`);

      const latest = await this.scrobbleRepo.findOne({
        where: { userId },
        select: { playedAt: true },
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

      const itemsReceived = data?.items?.length ?? 0;

      if (!itemsReceived) {
        this.logger.info(
          { jobId, userId: maskedUser, durationMs: Date.now() - startTime },
          `Sync finalizado: nenhuma música nova encontrada para ${maskedUser}.`,
        );
        return;
      }

      // Deduplicação em lote: busca todas as faixas já salvas para os timestamps recebidos em uma única query
      const playedAts = data.items.map((item) => new Date(item.played_at));
      const existingScrobbles = await this.scrobbleRepo.find({
        where: {
          userId,
          playedAt: In(playedAts),
        },
        select: {
          trackSpotifyId: true,
          playedAt: true,
        },
      });

      const existingSet = new Set(
        existingScrobbles.map(
          (s) => `${s.trackSpotifyId}:${new Date(s.playedAt).getTime()}`,
        ),
      );

      let inserted = 0;

      for (const item of data.items) {
        const playedAt = new Date(item.played_at);
        const dedupKey = `${item.track.id}:${playedAt.getTime()}`;

        if (existingSet.has(dedupKey)) continue;

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

        existingSet.add(dedupKey);
        inserted++;
      }

      if (inserted > 0) {
        try {
          // invalida todas as keys públicas desse usuário
          // próxima request reconstrói com dados frescos
          await this.cache.invalidatePattern(`public:profile:${user.slug}`);
          await this.cache.invalidatePattern(`public:overview:${user.slug}`);
          await this.cache.invalidatePattern(`public:recent:${user.slug}`);
          await this.cache.invalidatePattern(`public:hours:${user.slug}`);
          await this.cache.invalidatePattern(`public:timeline:${user.slug}`);
          this.logger.debug({ slug: user.slug }, `Cache invalidado para ${user.slug}`);
        } catch (cacheErr: any) {
          this.logger.warn(
            { err: cacheErr, slug: user.slug },
            `Falha ao invalidar cache após sync para ${user.slug} (scrobbles salvos com sucesso)`,
          );
        }
      }

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          jobId,
          userId: maskedUser,
          itemsReceived,
          inserted,
          durationMs,
        },
        `Sync concluído para ${maskedUser}: ${inserted}/${itemsReceived} scrobble(s) inserido(s) em ${durationMs}ms.`,
      );
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          err,
          jobId,
          userId: maskedUser,
          durationMs,
          message: err?.message,
        },
        `Erro durante a execução do sync para usuário ${maskedUser}`,
      );
      throw err; // relança para o BullMQ gerenciar o retry e backoff
    }
  }
}