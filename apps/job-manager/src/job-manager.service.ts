import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { CreateScrapeJobDto, DbOperationsFactoryService, DbOperationsService, Job, JobStatus, SCRAPE_QUEUE, NotFoundError, ScrapeJobData } from '@netnut/shared';

@Injectable()
export class JobManagerService {
  private readonly logger = new Logger(JobManagerService.name);
  private readonly jobDbOperation: DbOperationsService<Job>;

  constructor(
    private readonly dbFactory: DbOperationsFactoryService,
    @InjectQueue(SCRAPE_QUEUE) private readonly scrapeQueue: Queue<ScrapeJobData>,
  ) {
    this.jobDbOperation = this.dbFactory.getService<Job>(Job);
  }

  async createJob(dto: CreateScrapeJobDto): Promise<Job> {
    const saved = await this.jobDbOperation.create({
      url: dto.url,
      useProxy: dto.useProxy ?? false,
      status: JobStatus.PENDING,
    });

    await this.enqueueScrapeJob(saved);

    return saved;
  }

  private async enqueueScrapeJob(job: Job): Promise<void> {
    try {
      await this.addQueueJob(job);
      this.logger.log(`Enqueued job ${job.id} for URL: ${job.url}`);
    } catch (err) {
      await this.jobDbOperation.update(job.id, {
        status: JobStatus.FAILED,
        errorMessage: 'Failed to enqueue scrape job',
      });
      this.logger.error(`Failed to enqueue job ${job.id}: ${(err as Error).message}`);
      throw new Error('Failed to enqueue scrape job');
    }
  }

  private addQueueJob(job: Job) {
    return this.scrapeQueue.add(
      { jobId: job.id, url: job.url, useProxy: job.useProxy },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  async getJob(id: string) {
    const job = await this.jobDbOperation.findById(id);

    if(!job){
      throw new NotFoundError("Job doesn't exists")
    }

    return job
  }
}
