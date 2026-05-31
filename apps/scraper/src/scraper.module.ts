import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';
import {
  BullConnectionModule,
  createEnvValidator,
  databaseEnvSchema,
  Job,
  redisEnvSchema,
  scraperEnvSchema,
  SCRAPE_QUEUE,
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
        ...scraperEnvSchema,
        PROXY_URL: z.string().url().optional(),
      }),
    }),
    TypeOrmConnectionModule.forRoot([Job]),
    BullConnectionModule.forRoot([SCRAPE_QUEUE]),
  ],
  providers: [ScraperProcessor, ScraperService],
})
export class ScraperModule {}
