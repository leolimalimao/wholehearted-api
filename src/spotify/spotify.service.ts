import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { User } from '../auth/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { EncryptionService } from '../common/encryption/encryption.service';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);

  constructor(
    private http: HttpService,
    @InjectRepository(User) private userRepo: Repository<User>,
    private authService: AuthService,
    private encryption: EncryptionService,
  ) {}

  // Busca o único usuário do banco (você)
  private async getUser(): Promise<User> {
    const user = await this.userRepo.findOne({ where: {} });
    if (!user) throw new Error('Nenhum usuário autenticado encontrado.');
    return user;
  }

  // Garante que o access_token está válido, renovando se necessário
  private async getValidAccessToken(): Promise<string> {
    const user = await this.getUser();
    const now = new Date();
    const expiresAt = new Date(user.accessTokenExpiresAt);
    const bufferMs = 60 * 1000;
  
    if (expiresAt.getTime() - now.getTime() < bufferMs) {
      this.logger.log('Access token expirado — renovando...');
      return this.authService.refreshAccessToken(user);
    }
  
    return this.encryption.decrypt(user.encryptedAccessToken);
  }

  // Método central de request com tratamento de rate limit e refresh
  async get<T = any>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getValidAccessToken();

    const makeRequest = async (accessToken: string) =>
      firstValueFrom(
        this.http.get<T>(`${SPOTIFY_BASE}${endpoint}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params,
        }),
      );

    try {
      const res = await makeRequest(token);
      return res.data;
    } catch (err: unknown) {
      if (!isAxiosError(err)) {
        throw err;
      }

      const status = err.response?.status;

      // Rate limit: aguarda o tempo que o Spotify pede e tenta de novo
      if (status === 429) {
        const retryAfter = parseInt(
          String(err.response?.headers['retry-after'] ?? '2'),
          10,
        );
        this.logger.warn(`Rate limit atingido. Aguardando ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        const res = await makeRequest(token);
        return res.data;
      }

      throw err;
    }
  }

  // --- Endpoints da Spotify API ---

  getRecentlyPlayed(limit = 50, after?: number) {
    const params: Record<string, string> = { limit: String(limit) };
    if (after) params.after = String(after);
    return this.get<SpotifyRecentlyPlayedResponse>('/me/player/recently-played', params);
  }

  getTopTracks(timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 50) {
    return this.get('/me/top/tracks', { time_range: timeRange, limit: String(limit) });
  }

  getTopArtists(timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term', limit = 50) {
    return this.get('/me/top/artists', { time_range: timeRange, limit: String(limit) });
  }

  getCurrentlyPlaying() {
    return this.get('/me/player/currently-playing');
  }
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