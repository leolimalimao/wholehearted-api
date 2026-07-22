import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { User } from './entities/user.entity';
import { EncryptionService } from '../common/encryption/encryption.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private config: ConfigService,
    private http: HttpService,
    private encryption: EncryptionService,
  ) {}

  async exchangeCodeForTokens(code: string, codeVerifier: string) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.getOrThrow<string>('SPOTIFY_REDIRECT_URI'),
      client_id: this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID'),
      code_verifier: codeVerifier,
    });

    const response = await firstValueFrom(
      this.http.post('https://accounts.spotify.com/api/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    ).catch((err) => {
      throw new HttpException(
        `Falha ao trocar code por token: ${err.response?.data?.error_description ?? err.message}`,
        HttpStatus.BAD_REQUEST,
      );
    });

    return response.data; // { access_token, refresh_token, expires_in, ... }
  }

  async fetchSpotifyProfile(accessToken: string) {
    const response = await firstValueFrom(
      this.http.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    return response.data; // { id, display_name, ... }
  }

  async upsertUser(profile: any, tokens: any) {
    const existing = await this.userRepo.findOne({ where: { spotifyId: profile.id } });

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const payload = {
      spotifyId: profile.id,
      displayName: profile.display_name,
      encryptedRefreshToken: this.encryption.encrypt(tokens.refresh_token),
      encryptedAccessToken: this.encryption.encrypt(tokens.access_token),
      accessTokenExpiresAt: expiresAt,
    };

    if (existing) {
      await this.userRepo.update(existing.id, payload);
      return { ...existing, ...payload };
    }

    return this.userRepo.save(this.userRepo.create(payload));
  }

  async refreshAccessToken(user: User) {
    const refreshToken = this.encryption.decrypt(user.encryptedRefreshToken);

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID'),
    });

    const response = await firstValueFrom(
      this.http.post('https://accounts.spotify.com/api/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    const data = response.data;
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await this.userRepo.update(user.id, {
      encryptedAccessToken: this.encryption.encrypt(data.access_token),
      accessTokenExpiresAt: expiresAt,
      // Spotify às vezes manda um novo refresh_token também — se vier, atualiza
      ...(data.refresh_token && {
        encryptedRefreshToken: this.encryption.encrypt(data.refresh_token),
      }),
    });

    return data.access_token;
  }
}