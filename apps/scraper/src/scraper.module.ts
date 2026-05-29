import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { Job, TypeOrmConnectionModule } from '@netnut/shared';
import { ScraperProcessor } from './scraper.processor';
import { ScraperService } from './scraper.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmConnectionModule.forRoot([Job]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'scrape' }),
  ],
  providers: [ScraperProcessor, ScraperService],
})
export class ScraperModule {}
