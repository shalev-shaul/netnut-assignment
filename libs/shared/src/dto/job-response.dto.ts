import { Job, JobStatus } from '../entities/job.entity';

/**
 * Public-facing shape of a job. Deliberately omits the `proxy` field so
 * proxy credentials are never returned to API clients.
 */
export interface JobResponse {
  id: string;
  url: string;
  status: JobStatus;
  html: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toJobResponse(job: Job): JobResponse {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    html: job.html ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
