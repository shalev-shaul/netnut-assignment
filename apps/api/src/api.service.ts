import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError, TimeoutError } from 'rxjs';
import {
  CreateScrapeJobDto,
  JOB_MANAGER_PATTERNS,
  Job,
  JobResponse,
  toJobResponse,
} from '@netnut/shared';

// Fail fast if the Job Manager is unreachable instead of hanging the request.
const RPC_TIMEOUT_MS = 5000;

@Injectable()
export class ApiService {
  constructor(
    @Inject('JOB_MANAGER')
    private readonly jobManagerClient: ClientProxy,
  ) {}

  async createJob(dto: CreateScrapeJobDto): Promise<JobResponse> {
    const job = await this.send<Job>(JOB_MANAGER_PATTERNS.CREATE_JOB, dto);
    return toJobResponse(job);
  }

  async getJob(id: string): Promise<JobResponse> {
    const job = await this.send<Job | null>(JOB_MANAGER_PATTERNS.GET_JOB, id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return toJobResponse(job);
  }

  private send<T>(pattern: string, payload: unknown): Promise<T> {
    return firstValueFrom(
      this.jobManagerClient.send<T>(pattern, payload).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((err) =>
          err instanceof TimeoutError
            ? throwError(
                () =>
                  new ServiceUnavailableException(
                    'Job Manager did not respond in time',
                  ),
              )
            : throwError(() => err),
        ),
      ),
    );
  }
}
