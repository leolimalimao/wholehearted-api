import { Injectable, Optional } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { RedisService } from '../redis/redis.service';

export interface CacheMetrics {
  hits: number;
  misses: number;
  coalescedRequests: number;
  hitRatio: number;
}

@Injectable()
export class CacheService {
  private readonly PREFIX = 'cache:';
  private readonly DEFAULT_TTL = 60 * 10; // 10 minutos em segundos
  private readonly DEFAULT_JITTER_RATIO = 0.1; // ±10%
  private readonly DEFAULT_FLIGHT_TIMEOUT_MS = 15000; // 15 segundos
  public flightTimeoutMs = this.DEFAULT_FLIGHT_TIMEOUT_MS;

  private readonly inFlight = new Map<string, Promise<any>>();

  private metrics = {
    hits: 0,
    misses: 0,
    coalescedRequests: 0,
  };

  constructor(
    private redis: RedisService,
    @Optional()
    @InjectPinoLogger(CacheService.name)
    private readonly logger?: PinoLogger,
  ) {}

  private key(namespace: string, ...parts: string[]): string {
    return `${this.PREFIX}${namespace}:${parts.join(':')}`;
  }

  getMetrics(): CacheMetrics {
    const totalLookups = this.metrics.hits + this.metrics.misses;
    const hitRatio = totalLookups > 0 ? Number((this.metrics.hits / totalLookups).toFixed(4)) : 0;
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      coalescedRequests: this.metrics.coalescedRequests,
      hitRatio,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      coalescedRequests: 0,
    };
  }

  /**
   * Padrão Single-Flight (Request Coalescing) com Cache-Aside e Jitter.
   * Colapsa múltiplas chamadas concorrentes para a mesma chave em uma única
   * ida à fonte de dados (PostgreSQL), evitando Cache Stampede.
   *
   * Inclui Defensive Timeout: impede que Promises travadas residam no Map
   * indefinidamente e sejam promovidas para a Old Generation da heap do V8.
   */
  async getOrSet<T>(
    factory: () => Promise<T>,
    ttlSeconds: number = this.DEFAULT_TTL,
    namespace: string,
    ...parts: string[]
  ): Promise<T> {
    const cacheKey = this.key(namespace, ...parts);

    // 1. Otimização: se já existe uma computação em andamento, aguarda imediatamente
    const existingFlight = this.inFlight.get(cacheKey);
    if (existingFlight) {
      this.metrics.coalescedRequests++;
      this.logger?.debug({ key: cacheKey }, 'Single-flight: requisição coalescida em Promise em andamento');
      return (await existingFlight) as T;
    }

    // 2. Busca no cache Redis
    const cached = await this.get<T>(namespace, ...parts);
    if (cached !== null) {
      this.metrics.hits++;
      return cached;
    }

    // 3. Double-check: outra requisição pode ter iniciado a Promise enquanto aguardávamos o Redis
    const concurrentFlight = this.inFlight.get(cacheKey);
    if (concurrentFlight) {
      this.metrics.coalescedRequests++;
      this.logger?.debug({ key: cacheKey }, 'Single-flight: requisição coalescida após verificação no Redis');
      return (await concurrentFlight) as T;
    }

    // 4. Esta requisição é a pioneira (flyer): agenda a busca na fonte e registra no inFlight
    this.metrics.misses++;

    let timer: NodeJS.Timeout | null = null;
    const timeoutMs = this.flightTimeoutMs;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.inFlight.delete(cacheKey);
        this.logger?.error(
          { key: cacheKey, timeoutMs },
          'Single-flight: timeout defensivo atingido durante execução da factory de cache',
        );
        reject(
          new Error(
            `Single-flight cache execution timed out after ${timeoutMs}ms for key: ${cacheKey}`,
          ),
        );
      }, timeoutMs);
    });

    const executionPromise = (async () => {
      const result = await factory();
      await this.set(result, ttlSeconds, namespace, ...parts);
      return result;
    })();

    const flightPromise = Promise.race([executionPromise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, flightPromise);
    return await flightPromise;
  }

  /**
   * Calcula o TTL com ruído estocástico (jitter) para evitar Cache Avalanche
   * (múltiplas chaves expirando em sincronia).
   */
  calculateJitterTtl(ttlSeconds: number, jitterRatio: number = this.DEFAULT_JITTER_RATIO): number {
    if (jitterRatio <= 0 || ttlSeconds <= 0) return ttlSeconds;
    const min = Math.floor(ttlSeconds * (1 - jitterRatio));
    const max = Math.ceil(ttlSeconds * (1 + jitterRatio));
    return Math.floor(min + Math.random() * (max - min + 1));
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
    const effectiveTtl = this.calculateJitterTtl(ttlSeconds);
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(value),
        effectiveTtl,
      );
      this.logger?.debug(
        { key: cacheKey, ttlSeconds: effectiveTtl, baseTtl: ttlSeconds },
        'Chave gravada no cache com sucesso',
      );
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