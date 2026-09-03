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

  private getStartDate(range: TimeRange): Date | null {
    const now = new Date();
    const map: Record<TimeRange, number | null> = {
      week: 7, month: 30, '3months': 90,
      '6months': 180, year: 365, all: null,
    };
    const days = map[range];
    if (days === null) return null;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // userId sempre é o primeiro filtro — garante isolamento de dados
  // quando vier multi-tenant, nada muda aqui
  private applyFilters(qb: any, userId: string, range: TimeRange, alias = 's') {
    qb.where(`${alias}.userId = :userId`, { userId });
    const start = this.getStartDate(range);
    if (start) {
      qb.andWhere(`${alias}.playedAt >= :start`, { start });
    }
    return qb;
  }

  async getTotalScrobbles(userId: string, range: TimeRange = 'all') {
    const qb = this.scrobbleRepo.createQueryBuilder('s');
    this.applyFilters(qb, userId, range);
    return qb.getCount();
  }

  async getTopTracks(userId: string, range: TimeRange = 'month', limit = 10) {
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

    this.applyFilters(qb, userId, range);
    return qb.getRawMany();
  }

  async getTopArtists(userId: string, range: TimeRange = 'month', limit = 10) {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('s.artistName', 'artistName')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('s.artistName')
      .orderBy('plays', 'DESC')
      .limit(limit);

    this.applyFilters(qb, userId, range);
    return qb.getRawMany();
  }

  async getActivityByHour(userId: string, range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select(`EXTRACT(HOUR FROM s.playedAt AT TIME ZONE 'America/Sao_Paulo')`, 'hour')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('hour')
      .orderBy('hour', 'ASC');

    this.applyFilters(qb, userId, range);
    return qb.getRawMany();
  }

  async getActivityByDayOfWeek(userId: string, range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select(`EXTRACT(DOW FROM s.playedAt AT TIME ZONE 'America/Sao_Paulo')`, 'dow')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('dow')
      .orderBy('dow', 'ASC');

    this.applyFilters(qb, userId, range);
    return qb.getRawMany();
  }

  async getScrobblesPerDay(userId: string, range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select(`DATE_TRUNC('day', s.playedAt AT TIME ZONE 'America/Sao_Paulo')`, 'date')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('date')
      .orderBy('date', 'ASC');

    this.applyFilters(qb, userId, range);
    return qb.getRawMany();
  }

  async getRecentScrobbles(userId: string, limit = 20) {
    return this.scrobbleRepo.find({
      where: { userId },
      order: { playedAt: 'DESC' },
      take: limit,
    });
  }

  // overview agrega tudo numa chamada — usado pelo dashboard principal
  async getOverview(userId: string, range: TimeRange = 'month') {
    const [total, topTracks, topArtists, perDay] = await Promise.all([
      this.getTotalScrobbles(userId, range),
      this.getTopTracks(userId, range, 10),
      this.getTopArtists(userId, range, 10),
      this.getScrobblesPerDay(userId, range),
    ]);
    return { total, topTracks, topArtists, perDay };
  }
}