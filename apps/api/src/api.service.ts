import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { CreateScrapeJobDto, JobManagerPattern, Job } from '@netnut/shared';

@Injectable()
export class ApiService {
  constructor(
    @Inject('JOB_MANAGER') private readonly jobManagerClient: ClientProxy,
  ) {}

  createJob(createJobDto: CreateScrapeJobDto): Promise<Job> {
    return this.send<Job>(JobManagerPattern.CREATE_JOB, createJobDto);
  }

  getJob(id: string): Promise<Job> {
    return this.send<Job>(JobManagerPattern.GET_JOB, id);
  }

  private send<T>(pattern: JobManagerPattern, payload: unknown): Promise<T> {
    return firstValueFrom(
      this.jobManagerClient.send<T>(pattern, payload).pipe(timeout(5000)),
    );
  }
  
}
