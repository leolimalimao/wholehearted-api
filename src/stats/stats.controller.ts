import { Controller, Get, Query } from '@nestjs/common';
import { StatsService, TimeRange } from './stats.service';

// Valida que o range recebido é um dos valores permitidos.
// Se vier algo inválido, cai no default 'month'.
function parseRange(range: string): TimeRange {
  const valid: TimeRange[] = ['week', 'month', '3months', '6months', 'year', 'all'];
  return valid.includes(range as TimeRange) ? (range as TimeRange) : 'month';
}

@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  // GET /api/stats/overview?range=month
  // Retorna tudo que o dashboard principal precisa numa única chamada,
  // evitando que o front faça 5 requests separados ao carregar a página.
  @Get('overview')
  async getOverview(@Query('range') range = 'month') {
    const r = parseRange(range);
    const [total, topTracks, topArtists, perDay] = await Promise.all([
      this.statsService.getTotalScrobbles(r),
      this.statsService.getTopTracks(r, 10),
      this.statsService.getTopArtists(r, 10),
      this.statsService.getScrobblesPerDay(r),
    ]);

    return { total, topTracks, topArtists, perDay };
  }

  // GET /api/stats/top-tracks?range=month&limit=10
  @Get('top-tracks')
  getTopTracks(@Query('range') range = 'month', @Query('limit') limit = '10') {
    return this.statsService.getTopTracks(parseRange(range), parseInt(limit));
  }

  // GET /api/stats/top-artists?range=month&limit=10
  @Get('top-artists')
  getTopArtists(@Query('range') range = 'month', @Query('limit') limit = '10') {
    return this.statsService.getTopArtists(parseRange(range), parseInt(limit));
  }

  // GET /api/stats/activity/hours?range=month
  // Retorna 24 pontos (um por hora) com a contagem de plays — alimenta o gráfico de barras por hora.
  @Get('activity/hours')
  getActivityByHour(@Query('range') range = 'month') {
    return this.statsService.getActivityByHour(parseRange(range));
  }

  // GET /api/stats/activity/days?range=month
  // Retorna 7 pontos (um por dia da semana) — alimenta o gráfico de barras por dia.
  @Get('activity/days')
  getActivityByDayOfWeek(@Query('range') range = 'month') {
    return this.statsService.getActivityByDayOfWeek(parseRange(range));
  }

  // GET /api/stats/activity/timeline?range=month
  // Retorna um ponto por dia do período — alimenta o gráfico de linha de atividade.
  @Get('activity/timeline')
  getScrobblesPerDay(@Query('range') range = 'month') {
    return this.statsService.getScrobblesPerDay(parseRange(range));
  }

  // GET /api/stats/recent
  // Feed das últimas músicas ouvidas — aparece no topo do dashboard.
  @Get('recent')
  getRecentScrobbles(@Query('limit') limit = '20') {
    return this.statsService.getRecentScrobbles(parseInt(limit));
  }
}