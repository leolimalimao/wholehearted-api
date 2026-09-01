import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { JwtAuthModule } from './common/jwt/jwt.module';
import { AuthModule } from './auth/auth.module';
import { SpotifyModule } from './spotify/spotify.module';
import { ScrobblesModule } from './scrobbles/scrobbles.module';
import { SyncModule } from './sync/sync.module';
import { StatsModule } from './stats/stats.module';
import { RedisModule } from './common/redis/redis.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: process.env.NODE_ENV !== 'production',
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.getOrThrow<string>('REDIS_URL');
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port),
            password: url.password,
            tls: redisUrl.startsWith('rediss://') ? {} : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,  // janela de 60 segundos
        limit: 60,   // máximo 60 requests por janela por IP
      }
    ]),
    JwtAuthModule,
    AuthModule,
    SpotifyModule,
    ScrobblesModule,
    SyncModule,
    StatsModule,
    RedisModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    }
  ]
})
export class AppModule { }