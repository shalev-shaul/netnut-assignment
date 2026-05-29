import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateScrapeJobDto, JobManagerPattern } from '@netnut/shared';
import { JobManagerService } from './job-manager.service';

@Controller()
export class JobManagerController {
  constructor(private readonly service: JobManagerService) {}

  @MessagePattern(JobManagerPattern.CREATE_JOB)
  createJob(@Payload() dto: CreateScrapeJobDto) {
    return this.service.createJob(dto);
  }

  @MessagePattern(JobManagerPattern.GET_JOB)
  getJob(@Payload() id: string) {
    return this.service.getJob(id);
  }
}
