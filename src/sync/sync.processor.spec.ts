import { SyncProcessor } from './sync.processor';
import { SpotifyService } from '../spotify/spotify.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';
import { User } from '../auth/entities/user.entity';
import { Test } from '@nestjs/testing';
import { CacheService } from '../common/cache/cache.service';
import { getLoggerToken } from 'nestjs-pino';

// factory de item do recently-played pra não repetir em cada teste
function makeSpotifyItem(overrides: Partial<{ id: string; name: string; playedAt: string }> = {}) {
  return {
    track: {
      id: overrides.id ?? 'track-123',
      name: overrides.name ?? 'Pelo Amor de Deus',
      artists: [{ id: 'artist-1', name: 'Tim Maia' }],
      album: {
        id: 'album-1',
        name: 'Nobody Can Live Forever',
        images: [{ url: 'https://i.scdn.co/image/abc' }],
      },
      duration_ms: 240000,
    },
    played_at: overrides.playedAt ?? '2026-09-05T20:00:00.000Z',
  };
}

describe('SyncProcessor', () => {
  let processor: SyncProcessor;
  let spotifyService: jest.Mocked<SpotifyService>;
  let scrobbleRepo: jest.Mocked<any>;
  let userRepo: jest.Mocked<any>;
  let cacheService: jest.Mocked<CacheService>;

  const mockUser = {
    id: 'user-uuid-123',
    slug: 'leonardo',
    displayName: 'Leonardo',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SyncProcessor,
        {
          provide: SpotifyService,
          useValue: { getRecentlyPlayed: jest.fn() },
        },
        {
          provide: getRepositoryToken(Scrobble),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn((dto) => dto),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: CacheService,
          useValue: {
            invalidatePattern: jest.fn(),
          },
        },
        {
          provide: getLoggerToken(SyncProcessor.name),
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get(SyncProcessor);
    spotifyService = module.get(SpotifyService) as jest.Mocked<SpotifyService>;
    scrobbleRepo = module.get(getRepositoryToken(Scrobble));
    userRepo = module.get(getRepositoryToken(User));
    cacheService = module.get(CacheService) as jest.Mocked<CacheService>;
  });

  describe('quando não há usuário no banco', () => {
    it('encerra sem chamar a Spotify API', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(null);
      const job = { data: { userId: 'user-uuid-123' } } as any;

      // Act
      await processor.process(job);

      // Assert — nunca deve chamar a API se o usuário não existe
      expect(spotifyService.getRecentlyPlayed).not.toHaveBeenCalled();
    });
  });

  describe('quando não há músicas novas', () => {
    it('não insere nenhum scrobble', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne.mockResolvedValue(null); // sem scrobble anterior (cursor)
      spotifyService.getRecentlyPlayed.mockResolvedValue({ items: [] });
      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert
      expect(scrobbleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('deduplicação de scrobbles', () => {
    it('não insere scrobble que já existe no banco', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne
        .mockResolvedValueOnce(null) // cursor: sem scrobble anterior
        .mockResolvedValueOnce({ id: 'existing' }); // dedup: já existe

      spotifyService.getRecentlyPlayed.mockResolvedValue({
        items: [makeSpotifyItem()],
      });

      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert — save não deve ser chamado para item duplicado
      expect(scrobbleRepo.save).not.toHaveBeenCalled();
    });

    it('insere apenas músicas novas quando há mistura de novas e duplicadas', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);

      // cursor: sem scrobble anterior
      // dedup: primeira existe, segunda não existe
      scrobbleRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' }) // track-123 já existe
        .mockResolvedValueOnce(null);               // track-456 é nova

      spotifyService.getRecentlyPlayed.mockResolvedValue({
        items: [
          makeSpotifyItem({ id: 'track-123', playedAt: '2026-09-05T20:00:00.000Z' }),
          makeSpotifyItem({ id: 'track-456', playedAt: '2026-09-05T20:04:00.000Z' }),
        ],
      });

      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert — save chamado exatamente uma vez (só a música nova)
      expect(scrobbleRepo.save).toHaveBeenCalledTimes(1);
      expect(scrobbleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ trackSpotifyId: 'track-456' }),
      );
    });
  });

  describe('cursor de timestamp', () => {
    it('usa o playedAt do último scrobble como cursor para a API', async () => {
      // Arrange
      const lastPlayedAt = new Date('2026-09-05T19:00:00.000Z');
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne.mockResolvedValue({ playedAt: lastPlayedAt });
      spotifyService.getRecentlyPlayed.mockResolvedValue({ items: [] });

      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert — API chamada com userId, limit e timestamp corretos
      expect(spotifyService.getRecentlyPlayed).toHaveBeenCalledWith(
        mockUser.id,
        50,
        lastPlayedAt.getTime(),
      );
    });

    it('chama a API sem cursor quando não há scrobbles anteriores', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne.mockResolvedValue(null);
      spotifyService.getRecentlyPlayed.mockResolvedValue({ items: [] });

      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert — undefined como cursor = busca todo o histórico disponível
      expect(spotifyService.getRecentlyPlayed).toHaveBeenCalledWith(
        mockUser.id,
        50,
        undefined,
      );
    });
  });

  describe('invalidação de cache', () => {
    it('invalida o cache do usuário quando novos scrobbles são inseridos', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne
        .mockResolvedValueOnce(null)  // cursor
        .mockResolvedValueOnce(null); // dedup: não existe

      spotifyService.getRecentlyPlayed.mockResolvedValue({
        items: [makeSpotifyItem()],
      });

      const job = { data: { userId: mockUser.id } } as any;

      // Act
      await processor.process(job);

      // Assert — cache invalidado pra garantir dados frescos no próximo request
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith(
        expect.stringContaining('leonardo'),
      );
    });

    it('não quebra o sync se a invalidação de cache falhar', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      spotifyService.getRecentlyPlayed.mockResolvedValue({
        items: [makeSpotifyItem()],
      });
      cacheService.invalidatePattern.mockRejectedValue(new Error('Redis connection down'));

      const job = { data: { userId: mockUser.id } } as any;

      // Act & Assert — não deve lançar exceção
      await expect(processor.process(job)).resolves.not.toThrow();
      expect(scrobbleRepo.save).toHaveBeenCalled();
    });
  });

  describe('tratamento de falhas na sincronização', () => {
    it('relança o erro para o BullMQ gerenciar o retry se a Spotify API falhar', async () => {
      // Arrange
      userRepo.findOne.mockResolvedValue(mockUser);
      scrobbleRepo.findOne.mockResolvedValue(null);
      spotifyService.getRecentlyPlayed.mockRejectedValue(new Error('Spotify 503 Service Unavailable'));

      const job = { data: { userId: mockUser.id } } as any;

      // Act & Assert
      await expect(processor.process(job)).rejects.toThrow('Spotify 503 Service Unavailable');
    });
  });
});