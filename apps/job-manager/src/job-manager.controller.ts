import { Controller, NotFoundException } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateScrapeJobDto, JobManagerPattern, NotFoundError } from '@netnut/shared';
import { JobManagerService } from './job-manager.service';

@Controller()
export class JobManagerController {
  constructor(private readonly service: JobManagerService) {}

  @MessagePattern(JobManagerPattern.CREATE_JOB)
  createJob(@Payload() createJobDto: CreateScrapeJobDto) {
    return this.service.createJob(createJobDto);
  }

  @MessagePattern(JobManagerPattern.GET_JOB)
  getJob(@Payload() id: string) {
    try{
      return this.service.getJob(id);
    }catch(err){
      if(err instanceof NotFoundError){
        throw new NotFoundException(err)
      }
      return err
    }
  }
}
