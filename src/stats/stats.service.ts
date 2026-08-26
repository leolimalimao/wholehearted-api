import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';

export type TimeRange = 'week' | 'month' | '3months' | '6months' | 'year' | 'all';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Scrobble)
    private scrobbleRepo: Repository<Scrobble>,
  ) {}

  // Converte o timeRange em um Date de corte.
  // Todas as queries de período vão usar isso como ponto de partida.
  private getStartDate(range: TimeRange): Date | null {
    const now = new Date();
    const map: Record<TimeRange, number | null> = {
      week: 7,
      month: 30,
      '3months': 90,
      '6months': 180,
      year: 365,
      all: null,
    };
    const days = map[range];
    if (days === null) return null;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // Aplica o filtro de data no QueryBuilder se necessário.
  // Centralizar isso evita repetir o mesmo bloco em cada query.
  private applyDateFilter(qb: any, range: TimeRange, alias = 's') {
    const start = this.getStartDate(range);
    if (start) {
      qb.where(`${alias}.playedAt >= :start`, { start });
    }
    return qb;
  }

  // Total de scrobbles no período — número simples que vai pro topo do dashboard
  async getTotalScrobbles(range: TimeRange = 'all'): Promise<number> {
    const qb = this.scrobbleRepo.createQueryBuilder('s');
    this.applyDateFilter(qb, range);
    return qb.getCount();
  }

  // Top faixas: agrupa por nome da faixa + artista e conta quantas vezes aparece.
  // O alias "plays" é o que o front vai usar pra montar o gráfico de barras.
  async getTopTracks(range: TimeRange = 'month', limit = 10) {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('s.trackSpotifyId', 'trackSpotifyId')
      .addSelect('s.trackName', 'trackName')
      .addSelect('s.artistName', 'artistName')
      .addSelect('s.albumImageUrl', 'albumImageUrl')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('s.trackSpotifyId')
      .addGroupBy('s.trackName')
      .addGroupBy('s.artistName')
      .addGroupBy('s.albumImageUrl')
      .orderBy('plays', 'DESC')
      .limit(limit);

    this.applyDateFilter(qb, range);
    return qb.getRawMany();
  }

  // Top artistas: mesma lógica, mas agrupa só por artista.
  async getTopArtists(range: TimeRange = 'month', limit = 10) {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('s.artistName', 'artistName')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('s.artistName')
      .orderBy('plays', 'DESC')
      .limit(limit);

    this.applyDateFilter(qb, range);
    return qb.getRawMany();
  }

  // Atividade por hora do dia (0–23): útil pra mostrar em que hora você mais ouve música.
  // EXTRACT(HOUR FROM ...) é SQL padrão do Postgres — extrai só a hora do timestamp.
  async getActivityByHour(range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('EXTRACT(HOUR FROM s.playedAt AT TIME ZONE \'America/Sao_Paulo\')', 'hour')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('hour')
      .orderBy('hour', 'ASC');

    this.applyDateFilter(qb, range);
    return qb.getRawMany();
  }

  // Atividade por dia da semana (0=domingo, 6=sábado).
  // Combinado com o heatmap de hora, dá uma visão completa do seu padrão de escuta.
  async getActivityByDayOfWeek(range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('EXTRACT(DOW FROM s.playedAt AT TIME ZONE \'America/Sao_Paulo\')', 'dow')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('dow')
      .orderBy('dow', 'ASC');

    this.applyDateFilter(qb, range);
    return qb.getRawMany();
  }

  // Scrobbles por dia num período: alimenta o gráfico de linha de atividade ao longo do tempo.
  // DATE_TRUNC trunca o timestamp pra só a data (sem hora), agrupando tudo do mesmo dia.
  async getScrobblesPerDay(range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('DATE_TRUNC(\'day\', s.playedAt AT TIME ZONE \'America/Sao_Paulo\')', 'date')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('date')
      .orderBy('date', 'ASC');

    this.applyDateFilter(qb, range);
    return qb.getRawMany();
  }

  // Músicas ouvidas recentemente — pra montar o feed "últimas escutadas" do dashboard.
  async getRecentScrobbles(limit = 20) {
    return this.scrobbleRepo.find({
      order: { playedAt: 'DESC' },
      take: limit,
    });
  }
}