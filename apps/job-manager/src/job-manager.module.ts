import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';
import {
  createEnvValidator,
  databaseEnvSchema,
  DomainRpcExceptionFilter,
  Job,
  portSchema,
  redisEnvSchema,
  TypeOrmConnectionModule,
  validationPipeProvider,
} from '@netnut/shared';
import { JobManagerController } from './job-manager.controller';
import { JobManagerService } from './job-manager.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: createEnvValidator({
        JOB_MANAGER_PORT: portSchema,
        ...databaseEnvSchema,
        ...redisEnvSchema,
      }),
    }),
    TypeOrmConnectionModule.forRoot([Job]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'scrape' }),
  ],
  controllers: [JobManagerController],
  providers: [
    JobManagerService,
    validationPipeProvider,
    { provide: APP_FILTER, useClass: DomainRpcExceptionFilter },
  ],
})
export class JobManagerModule {}
