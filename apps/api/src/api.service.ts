import {Inject,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError, TimeoutError } from 'rxjs';
import {CreateScrapeJobDto,JobManagerPattern,Job,JobResponse,toJobResponse,NotFoundError} from '@netnut/shared';

// Fail fast if the Job Manager is unreachable instead of hanging the request.
const RPC_TIMEOUT_MS = 5000;

@Injectable()
export class ApiService {
  constructor(
    @Inject('JOB_MANAGER') private readonly jobManagerClient: ClientProxy,
  ) {}

  async createJob(dto: CreateScrapeJobDto) {
    const job = await this.send<Job>(JobManagerPattern.CREATE_JOB, dto);
    return toJobResponse(job);
  }

  async getJob(id: string): Promise<JobResponse> {
    const job = await this.send<Job>(JobManagerPattern.GET_JOB, id);
    return toJobResponse(job);
  }

  private send<T>(pattern: JobManagerPattern, payload: unknown): Promise<T> {
    return firstValueFrom(
      this.jobManagerClient.send<T>(pattern, payload).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((err) => throwError(() => this.toHttpError(err))),
      ),
    );
  }

  /** Translate transport/domain errors into HTTP exceptions at the edge. */
  private toHttpError(err: unknown): unknown {
    if (err instanceof TimeoutError) {
      return new ServiceUnavailableException('Job Manager did not respond in time');
    }
    if (this.isNotFound(err)) {
      return new NotFoundException((err as Error).message);
    }
    return err;
  }

  private isNotFound(err: unknown): boolean {
    // `instanceof` covers in-process throws; the `code` check covers errors
    // serialized across the TCP boundary, where the class prototype is lost.
    return (
      err instanceof NotFoundError ||
      (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'NOT_FOUND')
    );
  }
}
