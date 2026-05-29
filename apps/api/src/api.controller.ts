import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateScrapeJobDto } from '@netnut/shared';
import { ApiService } from './api.service';

@Controller('scrape')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Post()
  createJob(@Body() createJob: CreateScrapeJobDto) {
    return this.apiService.createJob(createJob);
  }

  @Get(':id')
  getJob(@Param('id') id: string) {
    return this.apiService.getJob(id);
  }
}
