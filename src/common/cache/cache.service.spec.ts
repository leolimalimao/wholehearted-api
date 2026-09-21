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
});
