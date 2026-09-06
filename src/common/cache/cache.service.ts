import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CacheService {
  private readonly PREFIX = 'cache:';
  private readonly DEFAULT_TTL = 60 * 10; // 10 minutos em segundos

  constructor(private redis: RedisService) {}

  private key(namespace: string, ...parts: string[]): string {
    return `${this.PREFIX}${namespace}:${parts.join(':')}`;
  }

  async get<T>(namespace: string, ...parts: string[]): Promise<T | null> {
    const raw = await this.redis.get(this.key(namespace, ...parts));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(
    value: T,
    ttlSeconds: number = this.DEFAULT_TTL,
    namespace: string,
    ...parts: string[]
  ): Promise<void> {
    await this.redis.set(
      this.key(namespace, ...parts),
      JSON.stringify(value),
      ttlSeconds,
    );
  }

  async invalidate(namespace: string, ...parts: string[]): Promise<void> {
    await this.redis.del(this.key(namespace, ...parts));
  }

  // invalida todas as keys de um namespace (ex: todas as keys de um slug)
  async invalidatePattern(pattern: string): Promise<void> {
    // implementação simples — lista keys e deleta
    // em volume alto usaríamos SCAN, mas pra esse contexto é suficiente
    const keys = await this.redis.list(`${this.PREFIX}${pattern}`);
    for (const key of keys) {
      await this.redis.del(key);
    }
  }
}