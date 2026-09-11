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
    const innerQb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('s.artistName', 'artistName')
      .addSelect('COUNT(*)', 'plays')
      .groupBy('s.artistName')
      .orderBy('plays', 'DESC')
      .limit(limit);

    this.applyFilters(innerQb, userId, range, 's');

    const outerQb = this.scrobbleRepo.manager
      .createQueryBuilder()
      .select('"ta"."artistName"', 'artistName')
      .addSelect('"ta"."plays"', 'plays')
      .addSelect(
        (sub) =>
          sub
            .select('s2.albumImageUrl')
            .from(Scrobble, 's2')
            .where('s2.userId = :userId')
            .andWhere('s2.artistName = "ta"."artistName"')
            .andWhere('s2.albumImageUrl IS NOT NULL')
            .orderBy('s2.playedAt', 'DESC')
            .limit(1),
        'imageUrl',
      )
      .from(`(${innerQb.getQuery()})`, 'ta')
      .setParameters({ ...innerQb.getParameters(), userId })
      .orderBy('"ta"."plays"', 'DESC');

    return outerQb.getRawMany();
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
      select: {
        id: true,
        trackSpotifyId: true,
        trackName: true,
        artistName: true,
        albumName: true,
        albumImageUrl: true,
        playedAt: true,
      },
      order: { playedAt: 'DESC' },
      take: limit,
    });
  }

  async getUniqueCounts(userId: string, range: TimeRange = 'month') {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select('COUNT(DISTINCT s.trackSpotifyId)', 'uniqueTracks')
      .addSelect('COUNT(DISTINCT s.artistName)', 'uniqueArtists');
    this.applyFilters(qb, userId, range);
    const res = await qb.getRawOne();
    return {
      uniqueTracks: parseInt(res?.uniqueTracks ?? '0', 10),
      uniqueArtists: parseInt(res?.uniqueArtists ?? '0', 10),
    };
  }

  async getActiveStreak(userId: string): Promise<number> {
    const qb = this.scrobbleRepo
      .createQueryBuilder('s')
      .select(`DISTINCT DATE(s.playedAt AT TIME ZONE 'America/Sao_Paulo')`, 'date')
      .where('s.userId = :userId', { userId })
      .orderBy('date', 'DESC')
      .limit(365);

    const rows = await qb.getRawMany<{ date: string | Date }>();
    if (!rows.length) return 0;

    const dates = rows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return d;
    });

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const now = new Date();
    const todayStr = formatter.format(now);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = formatter.format(yesterday);

    const firstDate = dates[0];
    if (firstDate !== todayStr && firstDate !== yesterdayStr) {
      return 0;
    }

    let streak = 0;
    let expectedDate = new Date(firstDate + 'T12:00:00Z');

    for (const dateStr of dates) {
      const currentDate = new Date(dateStr + 'T12:00:00Z');
      const diffDays = Math.round((expectedDate.getTime() - currentDate.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        streak++;
        expectedDate = new Date(expectedDate.getTime() - 24 * 60 * 60 * 1000);
      } else {
        break;
      }
    }

    return streak;
  }

  // overview agrega tudo numa chamada — usado pelo dashboard principal
  async getOverview(userId: string, range: TimeRange = 'month') {
    const [total, uniqueCounts, streak, topTracks, topArtists, perDay] = await Promise.all([
      this.getTotalScrobbles(userId, range),
      this.getUniqueCounts(userId, range),
      this.getActiveStreak(userId),
      this.getTopTracks(userId, range, 10),
      this.getTopArtists(userId, range, 10),
      this.getScrobblesPerDay(userId, range),
    ]);
    return {
      total,
      uniqueTracks: uniqueCounts.uniqueTracks,
      uniqueArtists: uniqueCounts.uniqueArtists,
      streak,
      topTracks,
      topArtists,
      perDay,
    };
  }
}