import { Controller, Get, Query, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StatsService, TimeRange } from './stats.service';
import { User } from '../auth/entities/user.entity';

function parseRange(range: string): TimeRange {
  const valid: TimeRange[] = ['week', 'month', '3months', '6months', 'year', 'all'];
  return valid.includes(range as TimeRange) ? (range as TimeRange) : 'month';
}

@Controller('stats')
export class StatsController {
  private cachedUserId: string | null = null;

  constructor(
    private statsService: StatsService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  private async resolveUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId;
    const user = await this.userRepo.findOne({ where: {} });
    if (!user) throw new NotFoundException('Nenhum usuário autenticado');
    this.cachedUserId = user.id;
    return this.cachedUserId;
  }

  @Get('overview')
  async getOverview(@Query('range') range = 'month') {
    const userId = await this.resolveUserId();
    return this.statsService.getOverview(userId, parseRange(range));
  }

  @Get('top-tracks')
  async getTopTracks(@Query('range') range = 'month', @Query('limit') limit = '10') {
    const userId = await this.resolveUserId();
    return this.statsService.getTopTracks(userId, parseRange(range), parseInt(limit));
  }

  @Get('top-artists')
  async getTopArtists(@Query('range') range = 'month', @Query('limit') limit = '10') {
    const userId = await this.resolveUserId();
    return this.statsService.getTopArtists(userId, parseRange(range), parseInt(limit));
  }

  @Get('activity/hours')
  async getActivityByHour(@Query('range') range = 'month') {
    const userId = await this.resolveUserId();
    return this.statsService.getActivityByHour(userId, parseRange(range));
  }

  @Get('activity/days')
  async getActivityByDayOfWeek(@Query('range') range = 'month') {
    const userId = await this.resolveUserId();
    return this.statsService.getActivityByDayOfWeek(userId, parseRange(range));
  }

  @Get('activity/timeline')
  async getScrobblesPerDay(@Query('range') range = 'month') {
    const userId = await this.resolveUserId();
    return this.statsService.getScrobblesPerDay(userId, parseRange(range));
  }

  @Get('recent')
  async getRecentScrobbles(@Query('limit') limit = '20') {
    const userId = await this.resolveUserId();
    return this.statsService.getRecentScrobbles(userId, parseInt(limit));
  }
}