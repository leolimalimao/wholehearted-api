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
    return this.cache.getOrSet(
      async () => {
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
          avatarUrl: user.avatarUrl ?? null,
          total,
          topTracks,
          topArtists,
        };
      },
      600,
      'public:profile',
      slug,
    );
  }

  @Get('profile/:slug/overview')
  async getPublicOverview(@Param('slug') slug: string, @Query('range') range = 'month') {
    const r = parseRange(range);
    return this.cache.getOrSet(
      async () => {
        const user = await this.authService.findBySlug(slug);
        if (!user) throw new NotFoundException('Perfil não encontrado');

        return this.statsService.getOverview(user.id, r);
      },
      600,
      'public:overview',
      slug,
      r,
    );
  }

  @Get('profile/:slug/recent')
  async getPublicRecent(@Param('slug') slug: string, @Query('limit') limit = '20') {
    return this.cache.getOrSet(
      async () => {
        const user = await this.authService.findBySlug(slug);
        if (!user) throw new NotFoundException('Perfil não encontrado');

        return this.statsService.getRecentScrobbles(user.id, parseInt(limit, 10));
      },
      600,
      'public:recent',
      slug,
    );
  }

  @Get('profile/:slug/hours')
  async getPublicHours(@Param('slug') slug: string, @Query('range') range = 'month') {
    const r = parseRange(range);
    return this.cache.getOrSet(
      async () => {
        const user = await this.authService.findBySlug(slug);
        if (!user) throw new NotFoundException('Perfil não encontrado');

        return this.statsService.getActivityByHour(user.id, r);
      },
      600,
      'public:hours',
      slug,
      r,
    );
  }

  @Get('profile/:slug/timeline')
  async getPublicTimeline(@Param('slug') slug: string, @Query('range') range = 'year') {
    const r = parseRange(range);
    return this.cache.getOrSet(
      async () => {
        const user = await this.authService.findBySlug(slug);
        if (!user) throw new NotFoundException('Perfil não encontrado');

        return this.statsService.getScrobblesPerDay(user.id, r);
      },
      600,
      'public:timeline',
      slug,
      r,
    );
  }
}