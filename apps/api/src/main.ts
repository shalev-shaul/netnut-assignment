import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  // Global ValidationPipe is registered via APP_PIPE in ApiModule.
  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  console.log(`API service is running on http://0.0.0.0:${port}`);
}

bootstrap();
