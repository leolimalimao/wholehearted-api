import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.util';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Get('login')
  login(@Res() res: Response) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Guarda o verifier e o state num cookie httpOnly temporário,
    // pra recuperar no callback e validar o state (anti-CSRF)
    res.cookie('spotify_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutos, tempo do fluxo
    });
    res.cookie('spotify_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });

    const scopes = ['user-top-read', 'user-read-recently-played', 'user-read-currently-playing'];

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
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (error) {
      return res.status(400).json({ error });
    }

    const savedState = req.cookies['spotify_state'];
    const codeVerifier = req.cookies['spotify_verifier'];

    if (!savedState || savedState !== state) {
      return res.status(403).json({ error: 'state_mismatch' });
    }

    const tokens = await this.authService.exchangeCodeForTokens(code, codeVerifier);
    const profile = await this.authService.fetchSpotifyProfile(tokens.access_token);
    await this.authService.upsertUser(profile, tokens);

    // Limpa os cookies temporários do fluxo OAuth
    res.clearCookie('spotify_state');
    res.clearCookie('spotify_verifier');

    // Aqui, futuramente, criamos a sessão do admin (você) —
    // por ora, só confirma que funcionou
    return res.json({ success: true, user: profile.display_name });
  }
}