import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SYNC_QUEUE } from './sync.processor';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(@InjectQueue(SYNC_QUEUE) private syncQueue: Queue) {}

  async onModuleInit() {
    const schedulers = await this.syncQueue.getJobSchedulers();
    for (const scheduler of schedulers) {
      await this.syncQueue.removeJobScheduler(scheduler.key);
    }

    await this.syncQueue.upsertJobScheduler(
      'recently-played-sync',        // chave única do scheduler
      { every: 5 * 60 * 1000 },      // a cada 5 minutos
      {
        name: 'recently-played-sync',
        opts: {
          removeOnComplete: 10,
          removeOnFail: 5,
        },
      },
    );

    // Disparo imediato pra testar
    await this.syncQueue.add('recently-played-sync-now', {});

    this.logger.log('Job de sync registrado — polling a cada 5 minutos.');
  }
}