import { Controller, UsePipes, ValidationPipe } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateScrapeJobDto, JOB_MANAGER_PATTERNS } from '@netnut/shared';
import { JobManagerService } from './job-manager.service';

@Controller()
export class JobManagerController {
  constructor(private readonly service: JobManagerService) {}

  @MessagePattern(JOB_MANAGER_PATTERNS.CREATE_JOB)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createJob(@Payload() dto: CreateScrapeJobDto) {
    return this.service.createJob(dto);
  }

  @MessagePattern(JOB_MANAGER_PATTERNS.GET_JOB)
  getJob(@Payload() id: string) {
    return this.service.getJob(id);
  }
}
