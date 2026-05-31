import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, validationPipeProvider } from '@netnut/shared';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ClientsModule.registerAsync([
      {
        name: 'JOB_MANAGER',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get('JOB_MANAGER_HOST'),
            port: config.get('JOB_MANAGER_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [ApiController, HealthController],
  providers: [
    ApiService,
    validationPipeProvider,
    { provide: APP_FILTER, useClass: RpcHttpExceptionFilter },
  ],
})
export class ApiModule {}
