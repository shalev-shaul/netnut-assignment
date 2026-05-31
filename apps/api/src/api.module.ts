import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { z } from 'zod';
import {
  createEnvValidator,
  portSchema,
  RpcHttpExceptionFilter,
  validationPipeProvider,
} from '@netnut/shared';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: createEnvValidator({
        API_PORT: portSchema,
        JOB_MANAGER_HOST: z.string(),
        JOB_MANAGER_PORT: portSchema,
      }),
    }),
    TerminusModule,
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
