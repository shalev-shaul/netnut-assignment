import {
  ArgumentsHost,
  Catch,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { TimeoutError } from 'rxjs';

@Catch()
export class RpcHttpExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(this.toHttpException(exception), host);
  }

  private toHttpException(exception: unknown): unknown {
    if (exception instanceof HttpException) {
      return exception;
    }
    if (exception instanceof TimeoutError) {
      return new ServiceUnavailableException('Job Manager did not respond in time');
    }
    if (this.codeOf(exception) === 'NOT_FOUND') {
      return new NotFoundException(this.messageOf(exception) ?? 'Not found');
    }
    return exception;
  }

  private codeOf(err: unknown): string | undefined {
    return typeof err === 'object' && err !== null
      ? (err as { code?: string }).code
      : undefined;
  }

  private messageOf(err: unknown): string | undefined {
    return typeof err === 'object' && err !== null
      ? (err as { message?: string }).message
      : undefined;
  }
}
