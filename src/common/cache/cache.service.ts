import { Injectable, Optional } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheService {
  private readonly PREFIX = 'cache:';
  private readonly DEFAULT_TTL = 60 * 10; // 10 minutos em segundos

  constructor(
    private redis: RedisService,
    @Optional()
    @InjectPinoLogger(CacheService.name)
    private readonly logger?: PinoLogger,
  ) {}

  private key(namespace: string, ...parts: string[]): string {
    return `${this.PREFIX}${namespace}:${parts.join(':')}`;
  }

  async get<T>(namespace: string, ...parts: string[]): Promise<T | null> {
    const cacheKey = this.key(namespace, ...parts);
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) {
        this.logger?.debug({ key: cacheKey }, 'Cache MISS');
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as T;
        this.logger?.debug({ key: cacheKey }, 'Cache HIT');
        return parsed;
      } catch (parseErr: any) {
        this.logger?.warn(
          { key: cacheKey, err: parseErr?.message },
          'Valor inválido/corrompido no cache — falha ao fazer JSON.parse',
        );
        return null;
      }
    } catch (err: any) {
      this.logger?.warn(
        { key: cacheKey, err: err?.message },
        'Falha ao ler cache do Redis — operando em fallback suave',
      );
      return null;
    }
  }

  async set<T>(
    value: T,
    ttlSeconds: number = this.DEFAULT_TTL,
    namespace: string,
    ...parts: string[]
  ): Promise<void> {
    const cacheKey = this.key(namespace, ...parts);
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(value),
        ttlSeconds,
      );
      this.logger?.debug({ key: cacheKey, ttlSeconds }, 'Chave gravada no cache com sucesso');
    } catch (err: any) {
      this.logger?.warn(
        { key: cacheKey, err: err?.message },
        'Falha ao gravar valor no cache do Redis',
      );
    }
  }

  async invalidate(namespace: string, ...parts: string[]): Promise<void> {
    const cacheKey = this.key(namespace, ...parts);
    try {
      await this.redis.del(cacheKey);
      this.logger?.debug({ key: cacheKey }, 'Chave de cache invalidada');
    } catch (err: any) {
      this.logger?.warn(
        { key: cacheKey, err: err?.message },
        'Falha ao invalidar chave no cache do Redis',
      );
    }
  }

  // invalida todas as keys de um namespace (ex: todas as keys de um slug)
  async invalidatePattern(pattern: string): Promise<void> {
    const fullPattern = `${this.PREFIX}${pattern}`;
    try {
      const keys = await this.redis.list(fullPattern);
      if (keys.length > 0) {
        for (const key of keys) {
          await this.redis.del(key);
        }
        this.logger?.debug({ pattern: fullPattern, count: keys.length }, 'Chaves invalidadas por padrão');
      }
    } catch (err: any) {
      this.logger?.warn(
        { pattern: fullPattern, err: err?.message },
        'Falha ao invalidar padrão de chaves no Redis',
      );
    }
  }
}