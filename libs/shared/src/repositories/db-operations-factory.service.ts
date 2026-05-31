import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { DbOperationsService } from './db-operations.service';

@Injectable()
export class DbOperationsFactoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  getService<T extends ObjectLiteral>(collectionName: EntityTarget<T>,) {
    return new DbOperationsService<T>(this.dataSource, collectionName);
  }
}
