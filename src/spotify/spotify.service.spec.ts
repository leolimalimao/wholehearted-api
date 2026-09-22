import { Test, TestingModule } from '@nestjs/testing';
import { SpotifyService } from './spotify.service';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { getLoggerToken } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

describe('SpotifyService', () => {
  let service: SpotifyService;
  let httpService: { get: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let authService: { refreshAccessToken: jest.Mock };
  let encryptionService: { encrypt: jest.Mock; decrypt: jest.Mock };
  let logger: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock; error: jest.Mock };

  const mockUser: Partial<User> = {
    id: 'user-uuid-1234',
    slug: 'test-user',
    accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // expira em 1 hora
    encryptedAccessToken: 'encrypted-access-token',
    encryptedRefreshToken: 'encrypted-refresh-token',
  };

  beforeEach(async () => {
    httpService = { get: jest.fn() };
    userRepo = { findOne: jest.fn().mockResolvedValue({ ...mockUser }) };
    authService = { refreshAccessToken: jest.fn().mockResolvedValue('refreshed-token') };
    encryptionService = {
      encrypt: jest.fn().mockReturnValue('encrypted-val'),
      decrypt: jest.fn().mockReturnValue('plain-access-token'),
    };
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpotifyService,
        { provide: HttpService, useValue: httpService },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuthService, useValue: authService },
        { provide: EncryptionService, useValue: encryptionService },
        { provide: getLoggerToken(SpotifyService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<SpotifyService>(SpotifyService);
  });

  describe('getRecentlyPlayed', () => {
    it('deve chamar o endpoint do Spotify com headers de autorização e timeout de 10s', async () => {
      const mockApiResponse: AxiosResponse = {
        data: { items: [], cursors: { after: '12345' } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      httpService.get.mockReturnValueOnce(of(mockApiResponse));

      const result = await service.getRecentlyPlayed(mockUser.id!, 50, 12345);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: {
          id: true,
          slug: true,
          accessTokenExpiresAt: true,
          encryptedAccessToken: true,
          encryptedRefreshToken: true,
        },
      });
      expect(encryptionService.decrypt).toHaveBeenCalledWith(mockUser.encryptedAccessToken);
      expect(httpService.get).toHaveBeenCalledWith(
        'https://api.spotify.com/v1/me/player/recently-played',
        {
          headers: { Authorization: 'Bearer plain-access-token' },
          params: { limit: '50', after: '12345' },
          timeout: 10000,
        },
      );
      expect(result).toEqual(mockApiResponse.data);
    });

    it('deve renovar o token se estiver a menos de 60s da expiração', async () => {
      userRepo.findOne.mockResolvedValueOnce({
        ...mockUser,
        accessTokenExpiresAt: new Date(Date.now() + 30 * 1000), // expira em 30 segundos
      });

      const mockApiResponse: AxiosResponse = {
        data: { items: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };
      httpService.get.mockReturnValueOnce(of(mockApiResponse));

      await service.getRecentlyPlayed(mockUser.id!);

      expect(authService.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(httpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer refreshed-token' },
        }),
      );
    });

    it('deve lidar com Rate Limit (HTTP 429) aguardando o Retry-After e reexecutando', async () => {
      jest.useFakeTimers();

      const rateLimitError = new AxiosError('Too Many Requests');
      rateLimitError.response = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'retry-after': '1' },
        data: { error: { message: 'rate limit' } },
        config: {} as InternalAxiosRequestConfig,
      };

      const successResponse: AxiosResponse = {
        data: { items: [{ track: { id: 't1' } }] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      httpService.get
        .mockReturnValueOnce(throwError(() => rateLimitError))
        .mockReturnValueOnce(of(successResponse));

      const promise = service.getRecentlyPlayed(mockUser.id!);

      // Avança o timer de 1s (Retry-After)
      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toEqual(successResponse.data);
      expect(httpService.get).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryAfter: 1 }),
        expect.stringContaining('Rate limit atingido no Spotify'),
      );

      jest.useRealTimers();
    });

    it('deve lançar erro e logar adequadamente em caso de timeout de rede (ECONNABORTED)', async () => {
      const timeoutError = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');
      timeoutError.code = 'ECONNABORTED';

      httpService.get.mockReturnValueOnce(throwError(() => timeoutError));

      await expect(service.getRecentlyPlayed(mockUser.id!)).rejects.toThrow(timeoutError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ECONNABORTED',
          message: 'timeout of 10000ms exceeded',
        }),
        expect.stringContaining('Timeout de requisição'),
      );
    });

    it('deve lançar erro caso o usuário não seja encontrado no banco', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.getRecentlyPlayed('non-existent-user')).rejects.toThrow(
        'Usuário non-existent-user não encontrado.',
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
