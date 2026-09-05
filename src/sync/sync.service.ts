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
      `recently-played-sync:${userId}`,
      { every: 10 * 60 * 1000 }, // 10 minutos em vez de 5
      {
        name: 'recently-played-sync',
        data: { userId },
        opts: {
          removeOnComplete: 5,  // guarda menos histórico
          removeOnFail: 3,
          attempts: 2,          // tenta 2x antes de falhar
          backoff: {
            type: 'exponential',
            delay: 30000,       // espera 30s antes de tentar de novo
          },
        },
      },
    );

    // disparo imediato ao subir depois entra no intervalo de 10min
    await this.syncQueue.add(
      'recently-played-sync-now',
      { userId },
      {
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.logger.log(`Job registrado para usuário ...${userId.slice(-4)} (intervalo: 10min)`);
  }
}