import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getLoggerToken } from 'nestjs-pino';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RedisService } from '../common/redis/redis.service';
import { JwtAuthService } from '../common/jwt/jwt.service';
import { SyncService } from '../sync/sync.service';

jest.mock('../common/jwt/jwt.service', () => ({
  JwtAuthService: class MockJwtAuthService {
    sign = jest.fn();
    verify = jest.fn();
  },
}));

const mockAuthService = () => ({
  exchangeCodeForTokens: jest.fn(),
  fetchSpotifyProfile: jest.fn(),
  upsertUser: jest.fn(),
});

const mockConfigService = () => ({
  get: jest.fn((key: string) => {
    if (key === 'FRONTEND_URL') return 'http://localhost:3000';
    if (key === 'NODE_ENV') return 'test';
    return null;
  }),
  getOrThrow: jest.fn((key: string) => {
    if (key === 'SPOTIFY_CLIENT_ID') return 'client-id';
    if (key === 'SPOTIFY_REDIRECT_URI') return 'http://localhost:3001/api/auth/callback';
    throw new Error(`Config ${key} not found`);
  }),
});

const mockRedisService = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

const mockJwtAuthService = () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn(),
});

const mockSyncService = () => ({
  registerSyncForUser: jest.fn(),
});

const mockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;
  let redisService: ReturnType<typeof mockRedisService>;
  let syncService: ReturnType<typeof mockSyncService>;
  let jwtAuthService: ReturnType<typeof mockJwtAuthService>;

  const createMockResponse = () => {
    const res: Partial<Response> = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };
    return res as unknown as Response;
  };

  beforeEach(async () => {
    authService = mockAuthService();
    redisService = mockRedisService();
    syncService = mockSyncService();
    jwtAuthService = mockJwtAuthService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: mockConfigService() },
        { provide: RedisService, useValue: redisService },
        { provide: JwtAuthService, useValue: jwtAuthService },
        { provide: SyncService, useValue: syncService },
        { provide: getLoggerToken(AuthController.name), useValue: mockLogger() },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('callback', () => {
    it('deve redirecionar para /auth/restricted quando o Spotify retornar parâmetro error', async () => {
      const res = createMockResponse();

      await controller.callback({ error: 'access_denied' }, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/auth/restricted?error=access_denied');
    });

    it('deve retornar status 403 quando state estiver ausente', async () => {
      const res = createMockResponse();

      await controller.callback({ code: 'valid-code' }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'missing_state' });
    });

    it('deve retornar status 403 quando o codeVerifier expirou ou for inválido no Redis', async () => {
      const res = createMockResponse();
      redisService.get.mockResolvedValueOnce(null);

      await controller.callback({ code: 'valid-code', state: 'invalid-state' }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'state_mismatch' });
    });

    it('deve redirecionar para /auth/restricted?error=callback_failed quando ocorrer falha inesperada', async () => {
      const res = createMockResponse();
      redisService.get.mockResolvedValueOnce('mock-verifier');
      authService.exchangeCodeForTokens.mockRejectedValueOnce(new Error('Spotify API down'));

      await controller.callback({ code: 'valid-code', state: 'valid-state' }, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/auth/restricted?error=callback_failed');
    });

    it('deve concluir o login com sucesso e redirecionar para a home do frontend', async () => {
      const res = createMockResponse();
      const mockTokens = { access_token: 'access-123', refresh_token: 'refresh-123' };
      const mockProfile = { id: 'spotify-user-id' };
      const mockUser = { id: 'user-uuid-1234', slug: 'leonardo' };

      redisService.get.mockResolvedValueOnce('mock-verifier');
      authService.exchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
      authService.fetchSpotifyProfile.mockResolvedValueOnce(mockProfile);
      authService.upsertUser.mockResolvedValueOnce(mockUser);
      syncService.registerSyncForUser.mockResolvedValueOnce(undefined);

      await controller.callback({ code: 'valid-code', state: 'valid-state' }, res);

      expect(redisService.del).toHaveBeenCalledWith('oauth:valid-state:verifier');
      expect(syncService.registerSyncForUser).toHaveBeenCalledWith(mockUser.id);
      expect(res.cookie).toHaveBeenCalledWith('session', 'mock-jwt-token', expect.any(Object));
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000');
    });
  });
});
