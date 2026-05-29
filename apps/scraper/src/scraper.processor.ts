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
} from '@app/shared';
import { ScraperService } from './scraper.service';

interface ScrapeJobData {
  jobId: string;
  url: string;
  proxy?: string;
}

@Processor(SCRAPE_QUEUE)
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    private readonly scraperService: ScraperService,
  ) {}

  @Process(SCRAPE_JOB_PROCESS)
  async handleScrape(bullJob: BullJob<ScrapeJobData>) {
    const { jobId, url, proxy } = bullJob.data;
    this.logger.log(`Processing job ${jobId}: ${url}`);

    await this.jobRepo.update(jobId, { status: JobStatus.PROCESSING });

    try {
      const html = await this.scraperService.fetchUrl(url, proxy);
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

      // An unsafe URL (SSRF rejection) is a permanent failure — retrying
      // would only waste attempts. Swallow it so BullMQ does not retry.
      if (err instanceof UnsafeUrlError) {
        return;
      }
      throw err;
    }
  }
}
