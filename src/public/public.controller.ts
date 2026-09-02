import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StatsService, TimeRange } from '../stats/stats.service';


// rotas públicas — sem AuthGuard
// usadas pelo Next.js no servidor pra gerar Open Graph
@Controller('public')
export class PublicController {
  constructor(
    private authService: AuthService,
    private statsService: StatsService,
  ) { }

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
      slug: user.slug,
      displayName: user.displayName,
      total,
      topTracks,
      topArtists,
    };
  }

  @Get('profile/:slug/overview')
  async getPublicOverview(
    @Param('slug') slug: string,
    @Query('range') range = 'month',
  ) {
    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');
    return this.statsService.getOverview(user.id, parseRange(range));
  }

  @Get('profile/:slug/recent')
  async getPublicRecent(
    @Param('slug') slug: string,
    @Query('limit') limit = '20',
  ) {
    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');
    return this.statsService.getRecentScrobbles(user.id, parseInt(limit));
  }

  @Get('profile/:slug/hours')
  async getPublicHours(
    @Param('slug') slug: string,
    @Query('range') range = 'month',
  ) {
    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');
    return this.statsService.getActivityByHour(user.id, parseRange(range));
  }
}

function parseRange(range: string): TimeRange {
  const valid: TimeRange[] = ['week', 'month', '3months', '6months', 'year', 'all'];
  return valid.includes(range as TimeRange) ? (range as TimeRange) : 'month';
}