import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheService } from './common/cache/cache.service';

describe('AppController', () => {
  let appController: AppController;
  let cacheService: { getMetrics: jest.Mock };

  beforeEach(async () => {
    cacheService = {
      getMetrics: jest.fn().mockReturnValue({
        hits: 10,
        misses: 2,
        coalescedRequests: 5,
        hitRatio: 0.8333,
      }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: CacheService,
          useValue: cacheService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('getCacheMetrics', () => {
    it('should return cache metrics from CacheService', () => {
      const result = appController.getCacheMetrics();
      expect(result).toEqual({
        hits: 10,
        misses: 2,
        coalescedRequests: 5,
        hitRatio: 0.8333,
      });
      expect(cacheService.getMetrics).toHaveBeenCalledTimes(1);
    });
  });
});
