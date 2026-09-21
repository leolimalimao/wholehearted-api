import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicController } from './public.controller';
import { AuthService } from '../auth/auth.service';
import { StatsService } from '../stats/stats.service';
import { CacheService } from '../common/cache/cache.service';

const mockCacheService = () => ({
  get: jest.fn(),
  set: jest.fn(),
  getOrSet: jest.fn(),
});

const mockAuthService = () => ({
  findBySlug: jest.fn(),
});

const mockStatsService = () => ({
  getScrobblesPerDay: jest.fn(),
  getRecentScrobbles: jest.fn(),
  getTotalScrobbles: jest.fn(),
  getTopTracks: jest.fn(),
  getTopArtists: jest.fn(),
  getOverview: jest.fn(),
  getActivityByHour: jest.fn(),
});

describe('PublicController', () => {
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

  describe('getPublicTimeline', () => {
    it('deve retornar dados do cache sem consultar serviços quando presente', async () => {
      const cached = [{ date: '2024-01-01', plays: 10 }];
      cacheService.getOrSet.mockResolvedValueOnce(cached);

      const result = await controller.getPublicTimeline(slug, 'year');

      expect(result).toBe(cached);
      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:timeline',
        slug,
        'year',
      );
      expect(authService.findBySlug).not.toHaveBeenCalled();
      expect(statsService.getScrobblesPerDay).not.toHaveBeenCalled();
    });

    it('deve buscar no StatsService via getOrSet quando não estiver em cache', async () => {
      const timelineData = [{ date: '2024-01-01', plays: 5 }];
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(user);
      statsService.getScrobblesPerDay.mockResolvedValueOnce(timelineData);

      const result = await controller.getPublicTimeline(slug, 'year');

      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:timeline',
        slug,
        'year',
      );
      expect(authService.findBySlug).toHaveBeenCalledWith(slug);
      expect(statsService.getScrobblesPerDay).toHaveBeenCalledWith(user.id, 'year');
      expect(result).toBe(timelineData);
    });

    it('deve lançar NotFoundException quando o usuário não existir', async () => {
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(undefined);

      await expect(controller.getPublicTimeline(slug, 'year')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPublicOverview', () => {
    it('deve retornar dados do cache quando presente', async () => {
      const cached = { totalScrobbles: 100 };
      cacheService.getOrSet.mockResolvedValueOnce(cached);

      const result = await controller.getPublicOverview(slug, 'month');

      expect(result).toBe(cached);
      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:overview',
        slug,
        'month',
      );
      expect(authService.findBySlug).not.toHaveBeenCalled();
      expect(statsService.getOverview).not.toHaveBeenCalled();
    });

    it('deve buscar no StatsService via getOrSet quando não estiver em cache', async () => {
      const overviewData = { totalScrobbles: 100 };
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(user);
      statsService.getOverview.mockResolvedValueOnce(overviewData);

      const result = await controller.getPublicOverview(slug, 'month');

      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:overview',
        slug,
        'month',
      );
      expect(authService.findBySlug).toHaveBeenCalledWith(slug);
      expect(statsService.getOverview).toHaveBeenCalledWith(user.id, 'month');
      expect(result).toBe(overviewData);
    });
  });

  describe('getPublicHours', () => {
    it('deve retornar dados do cache quando presente', async () => {
      const cached = [{ hour: 12, count: 5 }];
      cacheService.getOrSet.mockResolvedValueOnce(cached);

      const result = await controller.getPublicHours(slug, 'month');

      expect(result).toBe(cached);
      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:hours',
        slug,
        'month',
      );
      expect(authService.findBySlug).not.toHaveBeenCalled();
      expect(statsService.getActivityByHour).not.toHaveBeenCalled();
    });

    it('deve buscar no StatsService via getOrSet quando não estiver em cache', async () => {
      const hoursData = [{ hour: 12, count: 5 }];
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(user);
      statsService.getActivityByHour.mockResolvedValueOnce(hoursData);

      const result = await controller.getPublicHours(slug, 'month');

      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:hours',
        slug,
        'month',
      );
      expect(authService.findBySlug).toHaveBeenCalledWith(slug);
      expect(statsService.getActivityByHour).toHaveBeenCalledWith(user.id, 'month');
      expect(result).toBe(hoursData);
    });
  });

  describe('getPublicRecent', () => {
    it('retorna do cache se presente', async () => {
      const cached = [{ id: 'scrobble-1', trackName: 'Track' }];
      cacheService.getOrSet.mockResolvedValueOnce(cached);

      const result = await controller.getPublicRecent(slug, '20');

      expect(result).toBe(cached);
      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:recent',
        slug,
      );
      expect(authService.findBySlug).not.toHaveBeenCalled();
    });

    it('busca no StatsService via getOrSet se não estiver no cache', async () => {
      const recentData = [{ id: 'scrobble-1', trackName: 'Track' }];
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(user);
      statsService.getRecentScrobbles.mockResolvedValueOnce(recentData);

      const result = await controller.getPublicRecent(slug, '20');

      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:recent',
        slug,
      );
      expect(authService.findBySlug).toHaveBeenCalledWith(slug);
      expect(statsService.getRecentScrobbles).toHaveBeenCalledWith(user.id, 20);
      expect(result).toBe(recentData);
    });

    it('lança NotFoundException se usuário não existir', async () => {
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(null);

      await expect(controller.getPublicRecent(slug, '20')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPublicProfile', () => {
    it('retorna do cache se presente', async () => {
      const cached = { slug, displayName: 'Leonardo', avatarUrl: 'https://i.scdn.co/image/abc' };
      cacheService.getOrSet.mockResolvedValueOnce(cached);

      const result = await controller.getPublicProfile(slug);

      expect(result).toBe(cached);
      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:profile',
        slug,
      );
      expect(authService.findBySlug).not.toHaveBeenCalled();
    });

    it('busca no AuthService e StatsService, incluindo avatarUrl, e retorna via getOrSet', async () => {
      const userWithAvatar = {
        id: 'user-1',
        slug,
        displayName: 'Leonardo',
        avatarUrl: 'https://i.scdn.co/image/profile-pic',
      } as any;

      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(userWithAvatar);
      statsService.getTotalScrobbles.mockResolvedValueOnce(150);
      statsService.getTopTracks.mockResolvedValueOnce([]);
      statsService.getTopArtists.mockResolvedValueOnce([]);

      const result = await controller.getPublicProfile(slug);

      expect(cacheService.getOrSet).toHaveBeenCalledWith(
        expect.any(Function),
        600,
        'public:profile',
        slug,
      );
      expect(authService.findBySlug).toHaveBeenCalledWith(slug);
      expect(statsService.getTotalScrobbles).toHaveBeenCalledWith(userWithAvatar.id, 'all');
      expect(statsService.getTopTracks).toHaveBeenCalledWith(userWithAvatar.id, 'month', 5);
      expect(statsService.getTopArtists).toHaveBeenCalledWith(userWithAvatar.id, 'month', 5);

      const expected = {
        slug,
        displayName: 'Leonardo',
        avatarUrl: 'https://i.scdn.co/image/profile-pic',
        total: 150,
        topTracks: [],
        topArtists: [],
      };

      expect(result).toEqual(expected);
    });

    it('retorna avatarUrl como null se o usuário não possuir foto', async () => {
      const userWithoutAvatar = {
        id: 'user-1',
        slug,
        displayName: 'Leonardo',
        avatarUrl: null,
      } as any;

      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(userWithoutAvatar);
      statsService.getTotalScrobbles.mockResolvedValueOnce(0);
      statsService.getTopTracks.mockResolvedValueOnce([]);
      statsService.getTopArtists.mockResolvedValueOnce([]);

      const result = await controller.getPublicProfile(slug);

      expect(result.avatarUrl).toBeNull();
    });

    it('lança NotFoundException se usuário não existir', async () => {
      cacheService.getOrSet.mockImplementationOnce((factory) => factory());
      authService.findBySlug.mockResolvedValueOnce(null);

      await expect(controller.getPublicProfile(slug)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
