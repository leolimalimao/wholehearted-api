import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpotifyService } from '../spotify/spotify.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';

export const SYNC_QUEUE = 'sync';

@Processor(SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private spotifyService: SpotifyService,
    @InjectRepository(Scrobble) private scrobbleRepo: Repository<Scrobble>,
  ) {
    super();
  }

  async process(job: Job) {
    this.logger.log('Iniciando sync de recently-played...');

    // Busca o timestamp do scrobble mais recente no banco
    // pra usar como cursor (evita repuxar tudo toda vez)
    const latest = await this.scrobbleRepo.findOne({
      where: {},
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

      // Dedup: ignora se já existe esse track nesse timestamp exato
      const exists = await this.scrobbleRepo.findOne({
        where: {
          trackSpotifyId: item.track.id,
          playedAt,
        },
      });

      if (exists) continue;

      await this.scrobbleRepo.save(
        this.scrobbleRepo.create({
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