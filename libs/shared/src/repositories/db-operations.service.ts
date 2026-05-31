import {DataSource,DeepPartial,EntityTarget,FindOptionsWhere,ObjectLiteral,Repository} from 'typeorm';

export class DbOperationsService<T extends ObjectLiteral> {
  private readonly repo: Repository<T>;

  constructor(
    dataSource: DataSource,
    collectionName: EntityTarget<T>,
  ) {
    this.repo = dataSource.getRepository(collectionName);
  }

  async create(data: Partial<T>): Promise<T> {
    const entity = this.repo.create(data as DeepPartial<T>);
    const saved = await this.repo.save(entity);
    return saved as T;
  }

  findById(id: string): Promise<T | null> {
    return this.repo.findOne({
      where: { id } as unknown as FindOptionsWhere<T>,
    });
  }

  async update(id: string, data: Partial<T>): Promise<void> {
    await this.repo.update(
      id,
      data as unknown as Parameters<Repository<T>['update']>[1],
    );
  }

  find(where?: Partial<T>): Promise<T[]> {
    return this.repo.find({ where: where as FindOptionsWhere<T> | undefined });
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  count(where?: Partial<T>): Promise<number> {
    return this.repo.count({ where: where as FindOptionsWhere<T> | undefined });
  }
}
