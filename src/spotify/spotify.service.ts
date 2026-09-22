import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { User } from '../auth/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';

@Injectable()
export class SpotifyService {

  constructor(
    private http: HttpService,
    @InjectRepository(User) private userRepo: Repository<User>,
    private authService: AuthService,
    private encryption: EncryptionService,
    @InjectPinoLogger(SpotifyService.name)
    private readonly logger: PinoLogger,
  ) { }

  private async getUser(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        slug: true,
        accessTokenExpiresAt: true,
        encryptedAccessToken: true,
        encryptedRefreshToken: true,
      },
    });

    if (!user) {
      this.logger.warn({ userId: userId.slice(-4) }, `Usuário não encontrado no banco.`);
      throw new Error(`Usuário ${userId} não encontrado.`);
    }

    return user;
  }

  // Garante que o access_token está válido, renovando se necessário
  private async getValidAccessToken(userId: string): Promise<string> {
    const user = await this.getUser(userId);

    const now = new Date();
    const expiresAt = new Date(user.accessTokenExpiresAt);
    const bufferMs = 60 * 1000;

    if (expiresAt.getTime() - now.getTime() < bufferMs) {
      this.logger.info(`Access token expirado — renovando para ...${userId.slice(-4)}`);
      try {
        const token = await this.authService.refreshAccessToken(user);
        this.logger.info(`Access token renovado com sucesso para ...${userId.slice(-4)}`);
        return token;
      } catch (refreshErr: any) {
        this.logger.error(
          { err: refreshErr, userId: userId.slice(-4), message: refreshErr?.message },
          `Falha ao renovar access token para usuário ...${userId.slice(-4)}`,
        );
        throw refreshErr;
      }
    }

    try {
      return this.encryption.decrypt(user.encryptedAccessToken);
    } catch (decryptErr: any) {
      this.logger.error(
        { err: decryptErr, userId: userId.slice(-4) },
        `Falha ao decifrar access token para usuário ...${userId.slice(-4)}`,
      );
      throw decryptErr;
    }
  }

  // Método central de request com tratamento de rate limit e refresh
  async get<T = any>(
    userId: string,
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const token = await this.getValidAccessToken(userId);
    const startTime = Date.now();

    const makeRequest = async (accessToken: string) =>
      firstValueFrom(
        this.http.get<T>(`${SPOTIFY_BASE}${endpoint}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params,
          timeout: 10000,
        }),
      );

    try {
      const res = await makeRequest(token);
      const durationMs = Date.now() - startTime;
      this.logger.debug(
        { endpoint, durationMs, userId: userId.slice(-4) },
        `Spotify API GET ${endpoint} completado em ${durationMs}ms`,
      );
      return res.data;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;

      if (!isAxiosError(err)) {
        this.logger.error(
          { err, endpoint, durationMs, userId: userId.slice(-4) },
          `Erro inesperado na chamada ao Spotify em ${endpoint}`,
        );
        throw err;
      }

      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      if (isTimeout) {
        this.logger.error(
          {
            endpoint,
            code: err.code,
            durationMs,
            userId: userId.slice(-4),
            message: err.message,
          },
          `Timeout de requisição (${durationMs}ms) ao chamar Spotify API em ${endpoint}`,
        );
        throw err;
      }

      const status = err.response?.status;

      // Rate limit: aguarda o tempo que o Spotify pede e tenta de novo
      if (status === 429) {
        const retryAfter = parseInt(
          String(err.response?.headers['retry-after'] ?? '2'),
          10,
        );
        this.logger.warn(
          { endpoint, retryAfter, userId: userId.slice(-4) },
          `Rate limit atingido no Spotify. Aguardando ${retryAfter}s...`,
        );
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        const retryStart = Date.now();
        const res = await makeRequest(token);
        this.logger.info(
          { endpoint, durationMs: Date.now() - retryStart, userId: userId.slice(-4) },
          `Retry após 429 completado com sucesso em ${endpoint}`,
        );
        return res.data;
      }

      this.logger.error(
        {
          endpoint,
          status,
          durationMs,
          userId: userId.slice(-4),
          spotifyError: err.response?.data,
          message: err.message,
        },
        `Erro HTTP [${status ?? 'SEM_STATUS'}] retornado pela Spotify Web API em ${endpoint}`,
      );

      throw err;
    }
  }

  // --- Endpoints da Spotify API ---

  getRecentlyPlayed(userId: string, limit = 50, after?: number) {
    const params: Record<string, string> = {
      limit: String(limit),
    };

    if (after) params.after = String(after);

    return this.get<SpotifyRecentlyPlayedResponse>(
      userId,
      '/me/player/recently-played',
      params,
    );
  }

  getTopTracks(userId: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 50,) { return this.get(userId, '/me/top/tracks', { time_range: timeRange, limit: String(limit), },); }

  getTopArtists(userId: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 50,) { return this.get(userId, '/me/top/artists', { time_range: timeRange, limit: String(limit), },); }

  getCurrentlyPlaying(userId: string) { return this.get(userId, '/me/player/currently-playing',); }

  getUserProfile(userId: string): Promise<SpotifyUserProfile> {
    return this.get<SpotifyUserProfile>(userId, '/me');
  }
}

export interface SpotifyUserProfile {
  id: string;
  display_name: string;
  images?: { url: string; height: number | null; width: number | null }[];
}

// Tipos básicos que vamos usar no SyncModule
export interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: { id: string; name: string }[];
  album: { id: string; name: string; images: { url: string }[] };
}

export interface SpotifyRecentlyPlayedItem {
  track: SpotifyTrack;
  played_at: string; // ISO 8601
}

export interface SpotifyRecentlyPlayedResponse {
  items: SpotifyRecentlyPlayedItem[];
  cursors?: { before: string; after: string };
  next?: string;
}