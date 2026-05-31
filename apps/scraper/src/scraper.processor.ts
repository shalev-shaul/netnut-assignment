import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job as BullJob } from 'bull';
import { Repository } from 'typeorm';
import {
  Job,
  JobStatus,
  SCRAPE_JOB_PROCESS,
  SCRAPE_QUEUE,
  UnsafeUrlError,
} from '@netnut/shared';
import { ScraperService } from './scraper.service';

interface ScrapeJobData {
  jobId: string;
  url: string;
  useProxy?: boolean;
}

@Processor(SCRAPE_QUEUE)
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    private readonly scraperService: ScraperService,
  ) {}

  @Process(SCRAPE_JOB_PROCESS)
  async handleScrape(bullJob: BullJob<ScrapeJobData>) {
    const { jobId, url, useProxy } = bullJob.data;
    this.logger.log(`Processing job ${jobId}: ${url}`);

    await this.jobRepo.update(jobId, { status: JobStatus.PROCESSING });

    try {
      const html = await this.scraperService.fetchUrl(url, useProxy);
      await this.jobRepo.update(jobId, {
        status: JobStatus.DONE,
        html,
      });
      this.logger.log(`Job ${jobId} completed, HTML length: ${html.length}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${errorMessage}`);
      await this.jobRepo.update(jobId, {
        status: JobStatus.FAILED,
        errorMessage,
      });

      if (err instanceof UnsafeUrlError) {
        return;
      }
      throw err;
    }
  }
}
