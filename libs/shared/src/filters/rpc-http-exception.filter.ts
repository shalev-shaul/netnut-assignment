import {
  ArgumentsHost,
  Catch,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { TimeoutError } from 'rxjs';

/**
 * Global HTTP filter for API gateways. Translates errors that come back from a
 * microservice (over RPC) into the right HTTP status, then delegates the actual
 * rendering to Nest's BaseExceptionFilter.
 *
 * - TimeoutError is thrown in-process by the RPC timeout → `instanceof` works.
 * - Domain errors cross the TCP boundary as plain objects (the class prototype
 *   is lost), so they are matched on their serialized `code`, not `instanceof`.
 * - Anything already an HttpException, or anything unknown, is passed straight
 *   through (HttpException keeps its status; unknown renders as 500).
 */
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
