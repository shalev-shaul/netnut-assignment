import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/api/.env',
    }),
    ClientsModule.registerAsync([
      {
        name: 'JOB_MANAGER',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('JOB_MANAGER_HOST', 'localhost'),
            port: config.get<number>('JOB_MANAGER_PORT', 3001),
          },
        }),
      },
    ]),
  ],
  controllers: [ApiController, HealthController],
  providers: [
    ApiService,
    {
      // Global validation pipe registered through DI (recommended over
      // app.useGlobalPipes in main.ts — can inject deps and is part of the
      // module graph for testing).
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
export class ApiModule {}
