import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SYNC_QUEUE } from './sync.processor';
import { User } from '../auth/entities/user.entity';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Injectable()
export class SyncService implements OnModuleInit {

  constructor(
    @InjectQueue(SYNC_QUEUE) private syncQueue: Queue,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectPinoLogger(SyncService.name)
    private readonly logger: PinoLogger,
  ) { }

  async onModuleInit() {
    try {
      const schedulers = await this.syncQueue.getJobSchedulers();
      for (const scheduler of schedulers) {
        await this.syncQueue.removeJobScheduler(scheduler.key);
      }

      const users = await this.userRepo.find({
        select: { id: true },
      });

      if (!users.length) {
        this.logger.info('Nenhum usuário encontrado — aguardando primeiro login.');
        return;
      }

      for (const user of users) {
        await this.registerSyncForUser(user.id);
      }

      this.logger.info(`${users.length} job(s) de sync registrado(s).`);
    } catch (err: any) {
      this.logger.error(
        { err, message: err?.message },
        'Falha ao inicializar agendamentos de sincronização no SyncService.',
      );
    }
  }

  // parâmetro fireImmediate controla se dispara agora
  async registerSyncForUser(userId: string) {
    try {
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

      this.logger.info(`Job registrado para usuário ...${userId.slice(-4)}`);
    } catch (err: any) {
      this.logger.error(
        { err, userId: userId.slice(-4), message: err?.message },
        `Falha ao registrar job de sync no BullMQ para usuário ...${userId.slice(-4)}`,
      );
      throw err;
    }
  }
}