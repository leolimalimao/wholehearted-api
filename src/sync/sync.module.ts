import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncProcessor } from './sync.processor';
import { SYNC_QUEUE } from './sync.processor';
import { SpotifyModule } from '../spotify/spotify.module';
import { Scrobble } from '../scrobbles/entities/scrobble.entity';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [
    BullModule.registerQueue({ name: SYNC_QUEUE }),
    TypeOrmModule.forFeature([Scrobble, User]),
    SpotifyModule,
  ],
  providers: [SyncService, SyncProcessor],
})
export class SyncModule {}