import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SYNC_QUEUE } from './sync.processor';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private syncQueue: Queue,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) { }

  async onModuleInit() {
    const schedulers = await this.syncQueue.getJobSchedulers();
    for (const scheduler of schedulers) {
      await this.syncQueue.removeJobScheduler(scheduler.key);
    }
  
    const users = await this.userRepo.find();
  
    if (!users.length) {
      this.logger.log('Nenhum usuário encontrado — aguardando primeiro login.');
      return;
    }
  
    for (const user of users) {
      await this.registerSyncForUser(user.id);
    }
  
    this.logger.log(`${users.length} job(s) de sync registrado(s).`);
  }
  
  // parâmetro fireImmediate controla se dispara agora
  async registerSyncForUser(userId: string) {
    await this.syncQueue.upsertJobScheduler(
      `recently-played-sync:${userId}`,
      { every: 10 * 60 * 1000 },
      {
        name: 'recently-played-sync',
        data: { userId },
        opts: {
          removeOnComplete: 3,
          removeOnFail: 2,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30000 },
        },
      },
    );
  
    this.logger.log(`Job registrado para usuário ...${userId.slice(-4)}`);
  }
}