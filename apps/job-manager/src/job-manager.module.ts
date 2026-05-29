import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { Job, TypeOrmConnectionModule, validationPipeProvider } from '@netnut/shared';
import { JobManagerController } from './job-manager.controller';
import { JobManagerService } from './job-manager.service';

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
  controllers: [JobManagerController],
  providers: [JobManagerService, validationPipeProvider],
})
export class JobManagerModule {}
