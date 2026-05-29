import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { CreateScrapeJobDto, Job, JobStatus, SCRAPE_JOB_PROCESS, SCRAPE_QUEUE } from '@netnut/shared';

@Injectable()
export class JobManagerService {
  private readonly logger = new Logger(JobManagerService.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectQueue(SCRAPE_QUEUE)
    private readonly scrapeQueue: Queue,
  ) {}

  async createJob(dto: CreateScrapeJobDto): Promise<Job> {
    const job = this.jobRepo.create({
      url: dto.url,
      useProxy: dto.useProxy ?? false,
      status: JobStatus.PENDING,
    });
    const saved = await this.jobRepo.save(job);

    await this.scrapeQueue.add(
      SCRAPE_JOB_PROCESS,
      { jobId: saved.id, url: saved.url, useProxy: saved.useProxy },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    this.logger.log(`Enqueued job ${saved.id} for URL: ${saved.url}`);
    return saved;
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobRepo.findOne({ where: { id } });
  }
}
