import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scrobble } from './entities/scrobble.entity';
import { Track } from './entities/track.entity';
import { Artist } from './entities/artist.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Scrobble, Track, Artist])],
  exports: [TypeOrmModule],
})
export class ScrobblesModule {}