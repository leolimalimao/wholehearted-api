import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpotifyService } from './spotify.service';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { EncryptionService } from '../common/encryption/encryption.service';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([User]),
    forwardRef(() => AuthModule),
  ],
  providers: [SpotifyService, EncryptionService],
  exports: [SpotifyService],
})
export class SpotifyModule {}