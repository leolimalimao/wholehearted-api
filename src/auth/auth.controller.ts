import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RedisService } from '../common/redis/redis.service';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.util';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  @Get('login')
  async login(@Res() res: Response) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // guarda no Redis por 5 minutos em vez de cookie
    await this.redis.set(`oauth:${state}:verifier`, codeVerifier, 300);

    const scopes = [
      'user-top-read',
      'user-read-recently-played',
      'user-read-currently-playing',
    ];

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID'),
      scope: scopes.join(' '),
      redirect_uri: this.config.getOrThrow<string>('SPOTIFY_REDIRECT_URI'),
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      return res.status(400).json({ error });
    }

    if (!state) {
      return res.status(403).json({ error: 'missing_state' });
    }

    // recupera o verifier do Redis usando o state como chave
    const codeVerifier = await this.redis.get(`oauth:${state}:verifier`);

    if (!codeVerifier) {
      return res.status(403).json({ error: 'state_mismatch' });
    }

    // limpa do Redis imediatamente após usar
    await this.redis.del(`oauth:${state}:verifier`);

    const tokens = await this.authService.exchangeCodeForTokens(code, codeVerifier);
    const profile = await this.authService.fetchSpotifyProfile(tokens.access_token);
    await this.authService.upsertUser(profile, tokens);

    return res.json({ success: true, user: profile.display_name });
  }
}