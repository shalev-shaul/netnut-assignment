import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { typeOrmConfig } from '../config/typeorm.config';

@Module({})
export class TypeOrmConnectionModule {
  static forRoot(entities: EntityClassOrSchema[]): DynamicModule {
    const repositories = TypeOrmModule.forFeature(entities);

    return {
      module: TypeOrmConnectionModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: typeOrmConfig,
        }),
        repositories,
      ],
      exports: [repositories],
    };
  }
}
