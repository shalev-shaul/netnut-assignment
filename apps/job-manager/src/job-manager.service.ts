import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { CreateScrapeJobDto, Job, JobStatus, SCRAPE_JOB_PROCESS, SCRAPE_QUEUE, NotFoundError } from '@netnut/shared';

@Injectable()
export class JobManagerService {
  private readonly logger = new Logger(JobManagerService.name);

  constructor(
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectQueue(SCRAPE_QUEUE) private readonly scrapeQueue: Queue,
  ) {}

  async createJob(dto: CreateScrapeJobDto): Promise<Job> {
    const job = this.jobRepo.create({
      url: dto.url,
      useProxy: dto.useProxy ?? false,
      status: JobStatus.PENDING,
    });
    const saved = await this.jobRepo.save(job);

    await this.enqueueScrapeJob(saved);

    return saved;
  }

  private async enqueueScrapeJob(job: Job): Promise<void> {
    try {
      await this.addQueueJob(job);
      this.logger.log(`Enqueued job ${job.id} for URL: ${job.url}`);
    } catch (err) {
      await this.jobRepo.update(job.id, {
        status: JobStatus.FAILED,
        errorMessage: 'Failed to enqueue scrape job',
      });
      this.logger.error(`Failed to enqueue job ${job.id}: ${(err as Error).message}`);
      throw new Error('Failed to enqueue scrape job');
    }
  }

  private addQueueJob(job: Job) {
    return this.scrapeQueue.add(
      SCRAPE_JOB_PROCESS,
      { jobId: job.id, url: job.url, useProxy: job.useProxy },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  async getJob(id: string) {
    const job = await this.jobRepo.findOne({ where: { id } });

    if(!job){
      throw new NotFoundError("Job doesn't exists")
    }

    return job
  }
}
