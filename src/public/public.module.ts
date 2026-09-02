import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { AuthModule } from '../auth/auth.module';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [AuthModule, StatsModule],
  controllers: [PublicController],
})
export class PublicModule {}