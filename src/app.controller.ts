import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { CacheService } from './common/cache/cache.service';
import type { CacheMetrics } from './common/cache/cache.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('cache/metrics')
  getCacheMetrics(): CacheMetrics {
    return this.cacheService.getMetrics();
  }
}
