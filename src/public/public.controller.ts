import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StatsService } from '../stats/stats.service';

// rotas públicas — sem AuthGuard
// usadas pelo Next.js no servidor pra gerar Open Graph
@Controller('public')
export class PublicController {
  constructor(
    private authService: AuthService,
    private statsService: StatsService,
  ) {}

  @Get('profile/:slug')
  async getPublicProfile(@Param('slug') slug: string) {
    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const [total, topTracks, topArtists] = await Promise.all([
      this.statsService.getTotalScrobbles(user.id, 'all'),
      this.statsService.getTopTracks(user.id, 'month', 5),
      this.statsService.getTopArtists(user.id, 'month', 5),
    ]);

    return {
      slug:        user.slug,
      displayName: user.displayName,
      total,
      topTracks,
      topArtists,
    };
  }
}