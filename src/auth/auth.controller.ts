import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { AuthService } from './auth.service';
import { RedisService } from '../common/redis/redis.service';
import { JwtAuthService } from '../common/jwt/jwt.service';
import { SyncService } from '../sync/sync.service';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.util';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
    private redis: RedisService,
    private jwtAuth: JwtAuthService,
    private syncService: SyncService,
    @InjectPinoLogger(AuthController.name)
    private readonly logger: PinoLogger,
  ) { }

  @Get('login')
  async login(@Res() res: Response) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    await this.redis.set(`oauth:${state}:verifier`, codeVerifier, 300);
    this.logger.info({ state }, 'Fluxo de login OAuth iniciado. Redirecionando para Spotify.');

    const scopes = [
      'user-top-read',
      'user-read-recently-played',
      'user-read-currently-playing',
    ];

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.getOrThrow('SPOTIFY_CLIENT_ID'),
      scope: scopes.join(' '),
      redirect_uri: this.config.getOrThrow('SPOTIFY_REDIRECT_URI'),
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  }

  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const code = query['code'];
    const state = query['state'];
    const error = query['error'];
    const frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000';

    if (error) {
      this.logger.warn({ error }, 'Spotify retornou erro no callback de autorização.');
      return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    }

    if (!state) {
      this.logger.warn('Callback OAuth recebido sem parâmetro state.');
      return res.status(403).json({ error: 'missing_state' });
    }

    const codeVerifier = await this.redis.get(`oauth:${state}:verifier`);
    if (!codeVerifier) {
      this.logger.warn({ state }, 'state_mismatch ou verifier expirado no Redis durante callback OAuth.');
      return res.status(403).json({ error: 'state_mismatch' });
    }

    await this.redis.del(`oauth:${state}:verifier`);

    try {
      const tokens = await this.authService.exchangeCodeForTokens(code, codeVerifier);
      const profile = await this.authService.fetchSpotifyProfile(tokens.access_token);
      const user = await this.authService.upsertUser(profile, tokens);

      // registra ou atualiza o job de sync do user
      await this.syncService.registerSyncForUser(user.id);

      // gera JWT com userId e spotifyId
      const jwt = this.jwtAuth.sign({
        userId: user.id,
        spotifyId: profile.id,
        slug: user.slug,
      });

      const isProduction = this.config.get('NODE_ENV') === 'production';

      // seta cookie httpOnly — nunca acessível via JavaScript no browser
      res.cookie('session', jwt, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias em ms
      });

      this.logger.info(
        { userId: user.id.slice(-4), slug: user.slug },
        'Login OAuth finalizado com sucesso. Redirecionando para o frontend.',
      );

      // redireciona pro frontend em vez de retornar JSON
      res.redirect(frontendUrl);
    } catch (err: any) {
      this.logger.error(
        { err, message: err?.message },
        'Erro inesperado durante processamento do callback OAuth.',
      );
      return res.redirect(`${frontendUrl}?auth_error=callback_failed`);
    }
  }

  // endpoint pra o frontend verificar se há sessão ativa
  @Get('me')
  me(@Req() req: Request) {
    const token = req.cookies?.['session'];
    if (!token) return { authenticated: false };

    try {
      const payload = this.jwtAuth.verify(token);
      return {
        authenticated: true,
        spotifyId: payload.spotifyId,
        slug: payload.slug,
      };
    } catch {
      return { authenticated: false };
    }
  }

  // logout — limpa o cookie
  @Get('logout')
  logout(@Res() res: Response) {
    const isProduction = process.env.NODE_ENV === 'production';
    this.logger.info('Logout solicitado — removendo cookie de sessão.');
    res.clearCookie('session', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
    });
    return res.json({ success: true });
  }
}