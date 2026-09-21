import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { RedisService } from '../redis/redis.service';

describe('CacheService', () => {
  let service: CacheService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      list: jest.fn(),
      onModuleDestroy: jest.fn(),
    } as unknown as jest.Mocked<RedisService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: RedisService,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    redisService = module.get(RedisService) as jest.Mocked<RedisService>;
  });

  describe('calculateJitterTtl', () => {
    it('deve retornar o próprio TTL se jitter for <= 0', () => {
      expect(service.calculateJitterTtl(600, 0)).toBe(600);
      expect(service.calculateJitterTtl(600, -0.1)).toBe(600);
    });

    it('deve retornar o próprio TTL se ttlSeconds for <= 0', () => {
      expect(service.calculateJitterTtl(0, 0.1)).toBe(0);
      expect(service.calculateJitterTtl(-10, 0.1)).toBe(-10);
    });

    it('deve calcular jitter dentro do intervalo ±10% por padrão (entre 540 e 660 para base 600s)', () => {
      const baseTtl = 600;
      for (let i = 0; i < 50; i++) {
        const jitterTtl = service.calculateJitterTtl(baseTtl);
        expect(jitterTtl).toBeGreaterThanOrEqual(540);
        expect(jitterTtl).toBeLessThanOrEqual(660);
      }
    });

    it('deve respeitar os limites de Math.random (mínimo e máximo)', () => {
      const spyRandom = jest.spyOn(Math, 'random');

      // Testando limite inferior (random = 0)
      spyRandom.mockReturnValueOnce(0);
      const minVal = service.calculateJitterTtl(600, 0.1);
      expect(minVal).toBe(540);

      // Testando limite superior (random próximo de 1)
      spyRandom.mockReturnValueOnce(0.99999999);
      const maxVal = service.calculateJitterTtl(600, 0.1);
      expect(maxVal).toBe(660);

      spyRandom.mockRestore();
    });
  });

  describe('set', () => {
    it('deve aplicar jitter ao gravar chave no Redis', async () => {
      const spyRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      redisService.set.mockResolvedValueOnce();

      await service.set({ name: 'test' }, 600, 'public:profile', 'user-slug');

      expect(redisService.set).toHaveBeenCalledTimes(1);
      const [key, value, effectiveTtl] = redisService.set.mock.calls[0];

      expect(key).toBe('cache:public:profile:user-slug');
      expect(value).toBe(JSON.stringify({ name: 'test' }));
      // 540 + Math.floor(0.5 * 121) = 540 + 60 = 600
      expect(effectiveTtl).toBe(600);

      spyRandom.mockRestore();
    });

    it('não deve lançar erro se o Redis falhar na gravação (graceful degradation)', async () => {
      redisService.set.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(
        service.set('value', 600, 'test', 'key'),
      ).resolves.toBeUndefined();
    });
  });

  describe('get', () => {
    it('deve retornar dado desserializado quando chave existir (HIT)', async () => {
      const payload = { id: 1, name: 'track' };
      redisService.get.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await service.get<typeof payload>('public:profile', 'slug');

      expect(redisService.get).toHaveBeenCalledWith('cache:public:profile:slug');
      expect(result).toEqual(payload);
    });

    it('deve retornar null quando chave não existir (MISS)', async () => {
      redisService.get.mockResolvedValueOnce(null);

      const result = await service.get('public:profile', 'slug');

      expect(result).toBeNull();
    });

    it('deve retornar null em caso de JSON corrompido no Redis', async () => {
      redisService.get.mockResolvedValueOnce('in{valid-json');

      const result = await service.get('public:profile', 'slug');

      expect(result).toBeNull();
    });

    it('deve retornar null sem quebrar em caso de falha de conexão do Redis (graceful degradation)', async () => {
      redisService.get.mockRejectedValueOnce(new Error('Redis timeout'));

      const result = await service.get('public:profile', 'slug');

      expect(result).toBeNull();
    });
  });

  describe('invalidate e invalidatePattern', () => {
    it('deve invalidar chave única chamando del', async () => {
      redisService.del.mockResolvedValueOnce();

      await service.invalidate('public:profile', 'slug');

      expect(redisService.del).toHaveBeenCalledWith('cache:public:profile:slug');
    });

    it('deve invalidar lista de chaves correspondentes ao padrão', async () => {
      redisService.list.mockResolvedValueOnce([
        'cache:public:profile:user',
        'cache:public:overview:user',
      ]);
      redisService.del.mockResolvedValue();

      await service.invalidatePattern('public:*:user');

      expect(redisService.list).toHaveBeenCalledWith('cache:public:*:user');
      expect(redisService.del).toHaveBeenCalledTimes(2);
      expect(redisService.del).toHaveBeenCalledWith('cache:public:profile:user');
      expect(redisService.del).toHaveBeenCalledWith('cache:public:overview:user');
    });

    it('não deve quebrar caso o Redis falhe na invalidação', async () => {
      redisService.del.mockRejectedValueOnce(new Error('Redis error'));

      await expect(service.invalidate('test')).resolves.toBeUndefined();
    });
  });

  describe('getOrSet (Single-Flight / Request Coalescing)', () => {
    it('deve retornar do cache em caso de HIT sem executar a factory', async () => {
      const cachedData = { message: 'from-cache' };
      redisService.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const factory = jest.fn().mockResolvedValue({ message: 'from-db' });

      const result = await service.getOrSet(factory, 600, 'public:profile', 'user-1');

      expect(result).toEqual(cachedData);
      expect(factory).not.toHaveBeenCalled();
      expect(service.getMetrics().hits).toBe(1);
      expect(service.getMetrics().misses).toBe(0);
      expect(service.getMetrics().coalescedRequests).toBe(0);
    });

    it('deve executar a factory em caso de MISS, gravar no cache com jitter e retornar os dados', async () => {
      redisService.get.mockResolvedValueOnce(null);
      redisService.set.mockResolvedValueOnce();

      const dbData = { message: 'from-db', scrobbles: 42 };
      const factory = jest.fn().mockResolvedValue(dbData);

      const result = await service.getOrSet(factory, 600, 'public:profile', 'user-1');

      expect(result).toEqual(dbData);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(redisService.set).toHaveBeenCalledTimes(1);
      expect(service.getMetrics().misses).toBe(1);
      expect(service.getMetrics().hits).toBe(0);
    });

    it('deve coalescer múltiplas requisições concorrentes em uma única execução de factory (Single-Flight)', async () => {
      redisService.get.mockResolvedValue(null);
      redisService.set.mockResolvedValue();

      let resolveQuery: (val: any) => void;
      const delayedDbPromise = new Promise((resolve) => {
        resolveQuery = resolve;
      });

      const factory = jest.fn().mockImplementation(() => delayedDbPromise);

      // Dispara 10 requisições simultâneas para a mesma chave de cache
      const concurrentCalls = Array.from({ length: 10 }, () =>
        service.getOrSet(factory, 600, 'public:profile', 'same-slug'),
      );

      // Libera a resposta do banco com leve delay simulado
      const dbResponse = { profile: 'same-slug', total: 1000 };
      resolveQuery!(dbResponse);

      const results = await Promise.all(concurrentCalls);

      // 1. Todas as 10 requisições receberam o mesmo dado
      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res).toEqual(dbResponse);
      }

      // 2. A factory do banco foi invocada exatamente UMA vez
      expect(factory).toHaveBeenCalledTimes(1);

      // 3. Métricas auditadas com precisão: 1 miss pioneiro + 9 requisições coalescidas
      const metrics = service.getMetrics();
      expect(metrics.misses).toBe(1);
      expect(metrics.coalescedRequests).toBe(9);
    });

    it('deve limpar inFlight mesmo se a factory falhar, propagando o erro para todas as requisições em voo', async () => {
      redisService.get.mockResolvedValue(null);

      let rejectQuery: (err: any) => void;
      const delayedDbPromise = new Promise((_, reject) => {
        rejectQuery = reject;
      });

      const factory = jest.fn().mockImplementation(() => delayedDbPromise);

      // Dispara 4 requisições simultâneas
      const callers = Array.from({ length: 4 }, () =>
        service.getOrSet(factory, 600, 'public:profile', 'fail-slug'),
      );

      const dbError = new Error('Postgres connection pool timeout');
      rejectQuery!(dbError);

      // Todas as 4 requisições devem receber o mesmo erro
      const outcomes = await Promise.allSettled(callers);
      expect(outcomes).toHaveLength(4);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBe(dbError);
        }
      }

      // Requisição posterior para a mesma chave consegue executar uma nova factory (sem ficar travada)
      redisService.get.mockResolvedValueOnce(null);
      const retryFactory = jest.fn().mockResolvedValue({ recovered: true });
      const retryResult = await service.getOrSet(retryFactory, 600, 'public:profile', 'fail-slug');
      expect(retryResult).toEqual({ recovered: true });
      expect(retryFactory).toHaveBeenCalledTimes(1);
    });

    it('deve operar com graceful degradation caso o Redis falhe na leitura e na escrita', async () => {
      redisService.get.mockRejectedValueOnce(new Error('Redis unreachable'));
      redisService.set.mockRejectedValueOnce(new Error('Redis write failed'));

      const factory = jest.fn().mockResolvedValue({ status: 'ok' });

      const result = await service.getOrSet(factory, 600, 'public:profile', 'user-err');

      expect(result).toEqual({ status: 'ok' });
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMetrics e resetMetrics', () => {
    it('deve retornar métricas zeradas inicialmente', () => {
      service.resetMetrics();
      expect(service.getMetrics()).toEqual({
        hits: 0,
        misses: 0,
        coalescedRequests: 0,
        hitRatio: 0,
      });
    });

    it('deve calcular hitRatio corretamente', async () => {
      service.resetMetrics();

      // 3 hits
      redisService.get.mockResolvedValue(JSON.stringify({ data: 'hit' }));
      await service.getOrSet(jest.fn(), 600, 'test', 'k1');
      await service.getOrSet(jest.fn(), 600, 'test', 'k1');
      await service.getOrSet(jest.fn(), 600, 'test', 'k1');

      // 1 miss
      redisService.get.mockResolvedValueOnce(null);
      await service.getOrSet(jest.fn().mockResolvedValue({ data: 'miss' }), 600, 'test', 'k2');

      // Total lookups = 4 (3 hits, 1 miss). HitRatio = 3/4 = 0.75
      const metrics = service.getMetrics();
      expect(metrics.hits).toBe(3);
      expect(metrics.misses).toBe(1);
      expect(metrics.hitRatio).toBe(0.75);

      service.resetMetrics();
      expect(service.getMetrics().hits).toBe(0);
      expect(service.getMetrics().misses).toBe(0);
    });
  });
});
