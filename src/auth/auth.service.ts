import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { User } from './entities/user.entity';
import { EncryptionService } from '../common/encryption/encryption.service';
import { generateSlug, generateSlugWithSuffix } from '../common/utils/slug.util';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private config: ConfigService,
    private http: HttpService,
    private encryption: EncryptionService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  async exchangeCodeForTokens(code: string, codeVerifier: string) {
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  this.config.getOrThrow<string>('SPOTIFY_REDIRECT_URI'),
      client_id:     this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID'),
      code_verifier: codeVerifier,
    });

    try {
      const response = await firstValueFrom(
        this.http.post('https://accounts.spotify.com/api/token', params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }),
      );
      this.logger.info('Tokens OAuth obtidos com sucesso do Spotify.');
      return response.data;
    } catch (err: any) {
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      if (isTimeout) {
        this.logger.error({ err, code: err.code }, 'Timeout de 10s ao trocar code por tokens no Spotify');
        throw new HttpException('Timeout ao comunicar com o Spotify', HttpStatus.GATEWAY_TIMEOUT);
      }
      const errorDesc = err.response?.data?.error_description ?? err.response?.data?.error ?? err.message;
      this.logger.error(
        {
          err,
          status: err.response?.status,
          spotifyError: err.response?.data,
        },
        `Falha ao trocar code por token no Spotify: ${errorDesc}`,
      );
      throw new HttpException(
        `Falha ao trocar code por token: ${errorDesc}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async fetchSpotifyProfile(accessToken: string) {
    try {
      const response = await firstValueFrom(
        this.http.get('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10000,
        }),
      );
      this.logger.debug({ spotifyId: response.data?.id }, 'Perfil obtido com sucesso do Spotify.');
      return response.data;
    } catch (err: any) {
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      if (isTimeout) {
        this.logger.error({ err, code: err.code }, 'Timeout ao obter perfil do usuário no Spotify');
        throw new HttpException('Timeout ao obter perfil do Spotify', HttpStatus.GATEWAY_TIMEOUT);
      }
      this.logger.error(
        {
          err,
          status: err.response?.status,
          spotifyError: err.response?.data,
        },
        'Falha ao obter perfil do usuário no Spotify (GET /v1/me)',
      );
      throw new HttpException(
        `Falha ao obter perfil do Spotify: ${err.response?.data?.error?.message ?? err.message}`,
        err.response?.status ?? HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // gera um slug único — tenta o base e adiciona sufixo se já existir
  private async generateUniqueSlug(displayName: string, excludeId?: string): Promise<string> {
    const base = generateSlug(displayName);
    let slug = base;
    let suffix = 2;

    while (true) {
      const existing = await this.userRepo.findOne({
        where: { slug },
        select: { id: true, slug: true },
      });

      // não existe → slug disponível
      if (!existing) return slug;

      // existe mas é o próprio usuário sendo atualizado → mantém
      if (excludeId && existing.id === excludeId) return slug;

      // existe e é outro usuário → tenta com sufixo
      slug = generateSlugWithSuffix(base, suffix);
      suffix++;
    }
  }

  async upsertUser(profile: any, tokens: any): Promise<User> {
    const existing = await this.userRepo.findOne({
      where: { spotifyId: profile.id },
    });

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const avatarUrl = profile.images?.[0]?.url ?? null;

    if (existing) {
      // usuário existente — atualiza tokens e perfil mas mantém o slug
      await this.userRepo.update(existing.id, {
        displayName:            profile.display_name,
        avatarUrl,
        encryptedRefreshToken:  this.encryption.encrypt(tokens.refresh_token),
        encryptedAccessToken:   this.encryption.encrypt(tokens.access_token),
        accessTokenExpiresAt:   expiresAt,
      });
      this.logger.info(
        { userId: existing.id.slice(-4), slug: existing.slug },
        `Sessão de usuário existente atualizada: ${existing.slug}`,
      );
      return { ...existing, displayName: profile.display_name, avatarUrl };
    }

    // novo usuário — gera slug único
    const slug = await this.generateUniqueSlug(profile.display_name);

    const newUser = await this.userRepo.save(
      this.userRepo.create({
        spotifyId:             profile.id,
        displayName:           profile.display_name,
        avatarUrl,
        slug,
        encryptedRefreshToken: this.encryption.encrypt(tokens.refresh_token),
        encryptedAccessToken:  this.encryption.encrypt(tokens.access_token),
        accessTokenExpiresAt:  expiresAt,
      }),
    );

    this.logger.info(
      { userId: newUser.id.slice(-4), slug: newUser.slug },
      `Novo usuário cadastrado via OAuth: ${newUser.slug}`,
    );
    return newUser;
  }

  async refreshAccessToken(user: User): Promise<string> {
    const refreshToken = this.encryption.decrypt(user.encryptedRefreshToken);

    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID'),
    });

    try {
      const response = await firstValueFrom(
        this.http.post('https://accounts.spotify.com/api/token', params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }),
      );

      const data = response.data;
      const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

      await this.userRepo.update(user.id, {
        encryptedAccessToken: this.encryption.encrypt(data.access_token),
        accessTokenExpiresAt: newExpiresAt,
        ...(data.refresh_token && {
          encryptedRefreshToken: this.encryption.encrypt(data.refresh_token),
        }),
      });

      this.logger.info(
        { userId: user.id.slice(-4), slug: user.slug },
        `Access token renovado no Spotify com sucesso para usuário ...${user.id.slice(-4)}`,
      );

      return data.access_token;
    } catch (err: any) {
      const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      if (isTimeout) {
        this.logger.error(
          { err, userId: user.id.slice(-4), code: err.code },
          `Timeout de 10s ao renovar token junto à API do Spotify para usuário ...${user.id.slice(-4)}`,
        );
      } else {
        this.logger.error(
          {
            err,
            userId: user.id.slice(-4),
            spotifyError: err.response?.data,
            status: err.response?.status,
          },
          `Falha ao renovar token junto à API do Spotify para usuário ...${user.id.slice(-4)}`,
        );
      }
      throw err;
    }
  }

  async findBySlug(slug: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { slug },
      select: {
        id: true,
        slug: true,
        displayName: true,
        avatarUrl: true,
      },
    });
  }
}