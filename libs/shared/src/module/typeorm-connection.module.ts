import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { DbOperationsFactoryService } from '../repositories/db-operations-factory.service';

@Module({})
export class TypeOrmConnectionModule {
  static forRoot(entities: EntityClassOrSchema[]): DynamicModule {
    return {
      module: TypeOrmConnectionModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
              type: 'postgres',
              host: config.get('DB_HOST'),
              port: config.get<number>('DB_PORT'),
              username: config.get('DB_USER'),
              password: config.get('DB_PASS'),
              database: config.get('DB_NAME'),
              autoLoadEntities: true,
              synchronize: true,
          })
        }),
        TypeOrmModule.forFeature(entities),
      ],
      providers: [DbOperationsFactoryService],
      exports: [DbOperationsFactoryService],
    };
  }
}
