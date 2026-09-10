import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicController } from './public.controller';
import { AuthService } from '../auth/auth.service';
import { StatsService } from '../stats/stats.service';
import { CacheService } from '../common/cache/cache.service';

const mockCacheService = () => ({
  get: jest.fn(),
  set: jest.fn(),
});

const mockAuthService = () => ({
  findBySlug: jest.fn(),
});

const mockStatsService = () => ({
  getScrobblesPerDay: jest.fn(),
});

describe('PublicController - getPublicTimeline', () => {
  let controller: PublicController;
  let cacheService: ReturnType<typeof mockCacheService>;
  let authService: ReturnType<typeof mockAuthService>;
  let statsService: ReturnType<typeof mockStatsService>;

  const slug = 'leonardo';
  const user = { id: 'user-1', slug, displayName: 'Leonardo' } as any;

  beforeEach(async () => {
    cacheService = mockCacheService();
    authService = mockAuthService();
    statsService = mockStatsService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: StatsService, useValue: statsService },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    controller = module.get<PublicController>(PublicController);
  });

  it('should return cached data when present', async () => {
    const cached = { timeline: [] };
    cacheService.get.mockResolvedValueOnce(cached);
    const result = await controller.getPublicTimeline(slug, 'year');
    expect(result).toBe(cached);
    expect(cacheService.get).toHaveBeenCalledWith('public:timeline', slug, 'year');
    expect(authService.findBySlug).not.toHaveBeenCalled();
    expect(statsService.getScrobblesPerDay).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('should fetch from StatsService, cache the result and return it when not cached', async () => {
    const timelineData = [{ date: '2024-01-01', plays: 5 }];
    cacheService.get.mockResolvedValueOnce(null);
    authService.findBySlug.mockResolvedValueOnce(user);
    statsService.getScrobblesPerDay.mockResolvedValueOnce(timelineData);

    const result = await controller.getPublicTimeline(slug, 'year');

    expect(cacheService.get).toHaveBeenCalledWith('public:timeline', slug, 'year');
    expect(authService.findBySlug).toHaveBeenCalledWith(slug);
    expect(statsService.getScrobblesPerDay).toHaveBeenCalledWith(user.id, 'year');
    expect(cacheService.set).toHaveBeenCalledWith(timelineData, 600, 'public:timeline', slug, 'year');
    expect(result).toBe(timelineData);
  });

  it('should throw NotFoundException when user does not exist', async () => {
    cacheService.get.mockResolvedValueOnce(null);
    authService.findBySlug.mockResolvedValueOnce(undefined);

    await expect(controller.getPublicTimeline(slug, 'year')).rejects.toBeInstanceOf(NotFoundException);
    expect(cacheService.set).not.toHaveBeenCalled();
  });
});
