import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StatsService, TimeRange } from '../stats/stats.service';
import { CacheService } from '../common/cache/cache.service';

function parseRange(range: string): TimeRange {
  const valid: TimeRange[] = ['week', 'month', '3months', '6months', 'year', 'all'];
  return valid.includes(range as TimeRange) ? (range as TimeRange) : 'month';
}

@Controller('public')
export class PublicController {
  constructor(
    private authService: AuthService,
    private statsService: StatsService,
    private cache: CacheService,
  ) {}

  @Get('profile/:slug')
  async getPublicProfile(@Param('slug') slug: string) {
    const cached = await this.cache.get('public:profile', slug);
    if (cached) return cached;

    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const [total, topTracks, topArtists] = await Promise.all([
      this.statsService.getTotalScrobbles(user.id, 'all'),
      this.statsService.getTopTracks(user.id, 'month', 5),
      this.statsService.getTopArtists(user.id, 'month', 5),
    ]);

    const result = { slug: user.slug, displayName: user.displayName, total, topTracks, topArtists };

    await this.cache.set(result, 600, 'public:profile', slug);
    return result;
  }

  @Get('profile/:slug/overview')
  async getPublicOverview(@Param('slug') slug: string, @Query('range') range = 'month') {
    const r = parseRange(range);
    const cached = await this.cache.get('public:overview', slug, r);
    if (cached) return cached;

    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const result = await this.statsService.getOverview(user.id, r);

    await this.cache.set(result, 600, 'public:overview', slug, r);
    return result;
  }

  @Get('profile/:slug/recent')
  async getPublicRecent(@Param('slug') slug: string, @Query('limit') limit = '20') {
    const cached = await this.cache.get('public:recent', slug);
    if (cached) return cached;

    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const result = await this.statsService.getRecentScrobbles(user.id, parseInt(limit));

    await this.cache.set(result, 600, 'public:recent', slug);
    return result;
  }

  @Get('profile/:slug/hours')
  async getPublicHours(@Param('slug') slug: string, @Query('range') range = 'month') {
    const r = parseRange(range);
    const cached = await this.cache.get('public:hours', slug, r);
    if (cached) return cached;

    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const result = await this.statsService.getActivityByHour(user.id, r);

    await this.cache.set(result, 600, 'public:hours', slug, r);
    return result;
  }

  @Get('profile/:slug/timeline')
  async getPublicTimeline(@Param('slug') slug: string, @Query('range') range = 'year') {
    const r = parseRange(range);
    const cached = await this.cache.get('public:timeline', slug, r);
    if (cached) return cached;

    const user = await this.authService.findBySlug(slug);
    if (!user) throw new NotFoundException('Perfil não encontrado');

    const result = await this.statsService.getScrobblesPerDay(user.id, r);

    await this.cache.set(result, 600, 'public:timeline', slug, r);
    return result;
  }
}