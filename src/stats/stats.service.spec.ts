import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StatsService } from './stats.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';

describe('StatsService', () => {
  let service: StatsService;
  let scrobbleRepo: jest.Mocked<any>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StatsService,
        {
          provide: getRepositoryToken(Scrobble),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(StatsService);
    scrobbleRepo = module.get(getRepositoryToken(Scrobble));
  });

  describe('getRecentScrobbles', () => {
    it('busca scrobbles recentes projetando apenas campos visuais e id, sem vazar userId', async () => {
      // Arrange
      const userId = 'tenant-user-uuid';
      const mockResult = [
        {
          id: 'scrobble-uuid-1',
          trackSpotifyId: 'track-1',
          trackName: 'Track 1',
          artistName: 'Artist 1',
          albumName: 'Album 1',
          albumImageUrl: 'http://image.url',
          playedAt: new Date('2026-09-10T12:00:00Z'),
        },
      ];
      scrobbleRepo.find.mockResolvedValue(mockResult);

      // Act
      const result = await service.getRecentScrobbles(userId, 10);

      // Assert
      expect(scrobbleRepo.find).toHaveBeenCalledWith({
        where: { userId },
        select: {
          id: true,
          trackSpotifyId: true,
          trackName: true,
          artistName: true,
          albumName: true,
          albumImageUrl: true,
          playedAt: true,
        },
        order: { playedAt: 'DESC' },
        take: 10,
      });

      // Garante que o retorno contém o id para key do React e não vaza userId
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).not.toHaveProperty('userId');
      expect(result).toEqual(mockResult);
    });
  });
});
