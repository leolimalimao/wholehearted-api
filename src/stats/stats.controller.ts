import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { StatsService, TimeRange } from './stats.service';
import { AuthGuard } from '../common/guards/auth.guard';

function parseRange(range: string): TimeRange {
  const valid: TimeRange[] = ['week', 'month', '3months', '6months', 'year', 'all'];
  return valid.includes(range as TimeRange) ? (range as TimeRange) : 'month';
}

// AuthGuard aplicado em todas as rotas do controller
// quando vier multi-tenant, nada muda aqui — req.user.id já é por usuário
@UseGuards(AuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) { }

  // req.user é populado pelo AuthGuard após validar o JWT
  // userId vem do token — sem query ao banco, sem cache necessário
  private resolveUserId(req: Request): string {
    return (req as any).user.userId;
  }

  @Get('overview')
  async getOverview(@Req() req: Request, @Query('range') range = 'month') {
    return this.statsService.getOverview(this.resolveUserId(req), parseRange(range));
  }

  @Get('top-tracks')
  async getTopTracks(
    @Req() req: Request,
    @Query('range') range = 'month',
    @Query('limit') limit = '10',
  ) {
    return this.statsService.getTopTracks(
      this.resolveUserId(req),
      parseRange(range),
      parseInt(limit),
    );
  }

  @Get('top-artists')
  async getTopArtists(
    @Req() req: Request,
    @Query('range') range = 'month',
    @Query('limit') limit = '10',
  ) {
    return this.statsService.getTopArtists(
      this.resolveUserId(req),
      parseRange(range),
      parseInt(limit),
    );
  }

  @Get('activity/hours')
  async getActivityByHour(@Req() req: Request, @Query('range') range = 'month') {
    return this.statsService.getActivityByHour(this.resolveUserId(req), parseRange(range));
  }

  @Get('activity/days')
  async getActivityByDayOfWeek(@Req() req: Request, @Query('range') range = 'month') {
    return this.statsService.getActivityByDayOfWeek(this.resolveUserId(req), parseRange(range));
  }

  @Get('activity/timeline')
  async getScrobblesPerDay(@Req() req: Request, @Query('range') range = 'month') {
    return this.statsService.getScrobblesPerDay(this.resolveUserId(req), parseRange(range));
  }

  @Get('recent')
  async getRecentScrobbles(@Req() req: Request, @Query('limit') limit = '20') {
    return this.statsService.getRecentScrobbles(this.resolveUserId(req), parseInt(limit));
  }
}