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
  ) {}

  async onModuleInit() {
    // remove todos os schedulers antigos e evita duplicar ao reiniciar
    const schedulers = await this.syncQueue.getJobSchedulers();
    for (const scheduler of schedulers) {
      await this.syncQueue.removeJobScheduler(scheduler.key);
    }

    // busca todos os usuários e registra um job pra cada um
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

  // chamado pelo AuthController após cada novo login
  // registra ou atualiza o job daquele usuário específico
  async registerSyncForUser(userId: string) {
    await this.syncQueue.upsertJobScheduler(
      `recently-played-sync:${userId}`, // chave única por usuário
      { every: 5 * 60 * 1000 },
      {
        name: 'recently-played-sync',
        data: { userId }, // userId no payload do job
        opts: {
          removeOnComplete: 10,
          removeOnFail: 5,
        },
      },
    );

    // disparo imediato pra não esperar 5min no primeiro sync
    await this.syncQueue.add('recently-played-sync-now', { userId });

    this.logger.log(`Job registrado para usuário ...${userId.slice(-4)}`);
  }
}