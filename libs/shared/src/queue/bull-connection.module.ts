import { BullModule } from '@nestjs/bull';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Module({})
export class BullConnectionModule {
  static forRoot(queues: string[]): DynamicModule {
    const registeredQueues = BullModule.registerQueue(
      ...queues.map((name) => ({ name })),
    );

    return {
      module: BullConnectionModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            redis: {
              host: config.get('REDIS_HOST'),
              port: config.get('REDIS_PORT'),
            },
          }),
        }),
        registeredQueues,
      ],
      exports: [registeredQueues],
    };
  }
}
