import { NestFactory } from '@nestjs/core';
import { ScraperModule } from './scraper.module';

async function bootstrap() {
  const app = await NestFactory.create(ScraperModule);

  await app.init();
  
  console.log('Scraper worker is running');
}

bootstrap();
