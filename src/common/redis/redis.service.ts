import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis;

  constructor(
    private config: ConfigService,
    @Optional()
    @InjectPinoLogger(RedisService.name)
    private readonly logger?: PinoLogger,
  ) {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      tls: url.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.client.on('connect', () => {
      this.logger?.info('Conexão estabelecida com o Redis.');
    });

    this.client.on('error', (err) => {
      this.logger?.error({ err, message: err?.message }, 'Erro na conexão com o Redis (ioredis).');
    });

    this.client.on('reconnecting', (delay: number) => {
      this.logger?.warn({ delay }, `Reconectando ao Redis em ${delay}ms...`);
    });
  }

  async set(key: string, value: string, ttlSeconds: number) {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err: any) {
      this.logger?.error({ key, err, message: err?.message }, 'Erro ao gravar chave no Redis.');
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err: any) {
      this.logger?.error({ key, err, message: err?.message }, 'Erro ao obter chave do Redis.');
      throw err;
    }
  }

  async del(key: string) {
    try {
      await this.client.del(key);
    } catch (err: any) {
      this.logger?.error({ key, err, message: err?.message }, 'Erro ao remover chave do Redis.');
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      return await this.client.keys(`${prefix}*`);
    } catch (err: any) {
      this.logger?.error({ prefix, err, message: err?.message }, 'Erro ao listar chaves do Redis.');
      throw err;
    }
  }

  onModuleDestroy() {
    this.logger?.info('Desconectando cliente Redis.');
    this.client.disconnect();
  }
}