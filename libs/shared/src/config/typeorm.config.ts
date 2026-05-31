import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Shared TypeORM connection config.
 *
 * Used by {@link TypeOrmConnectionModule}. Entities are NOT listed here —
 * `autoLoadEntities` pulls in whatever each app registers via the module's
 * `forRoot([...])`, so the connection config stays entity-agnostic.
 *
 * Values come from each app's environment.
 */
export function typeOrmConfig(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get('DB_USER'),
    password: config.get('DB_PASS'),
    database: config.get('DB_NAME'),
    autoLoadEntities: true,
    synchronize: true,
  };
}
