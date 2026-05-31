import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { z } from 'zod';
import {
  createEnvValidator,
  databaseEnvSchema,
  Job,
  redisEnvSchema,
  TypeOrmConnectionModule,
} from '@netnut/shared';
import { ScraperProcessor } from './scraper.processor';
import { ScraperService } from './scraper.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: createEnvValidator({
        ...databaseEnvSchema,
        ...redisEnvSchema,
        // Operator-supplied proxy connection string; optional, but if present it
        // must be a valid URL. Empty string = "no proxy configured".
        PROXY_URL: z.string().url().optional(),
      }),
    }),
    TypeOrmConnectionModule.forRoot([Job]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'scrape' }),
  ],
  providers: [ScraperProcessor, ScraperService],
})
export class ScraperModule {}
