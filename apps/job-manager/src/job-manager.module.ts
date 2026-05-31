import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  BullConnectionModule,
  createEnvValidator,
  databaseEnvSchema,
  DomainRpcExceptionFilter,
  Job,
  portSchema,
  redisEnvSchema,
  SCRAPE_QUEUE,
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
    BullConnectionModule.forRoot([SCRAPE_QUEUE]),
  ],
  controllers: [JobManagerController],
  providers: [
    JobManagerService,
    validationPipeProvider,
    { provide: APP_FILTER, useClass: DomainRpcExceptionFilter },
  ],
})
export class JobManagerModule {}
