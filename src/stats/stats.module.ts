import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Scrobble])],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}