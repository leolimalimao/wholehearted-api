import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { EncryptionService } from '../common/encryption/encryption.service';
import { SpotifyModule } from '../spotify/spotify.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    HttpModule,
    forwardRef(() => SpotifyModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, EncryptionService],
  exports: [AuthService],
})
export class AuthModule {}