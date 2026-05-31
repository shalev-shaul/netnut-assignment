import { ArgumentsHost, Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { NotFoundError } from '../errors/errors';

/**
 * Serializes domain errors into an RpcException-style payload so they survive
 * the TCP boundary. NestJS only forwards `RpcException` payloads as-is; any
 * other thrown error is replaced with a generic "Internal server error" and
 * its `code`/`message` are lost. By emitting `{ code, message }` here, the API
 * gateway can map the error back to the right HTTP status.
 *
 * Only known domain errors are caught; everything else falls through to the
 * default handler (logged + generic message), so internals never leak.
 *
 * Register in a microservice module via:
 *   { provide: APP_FILTER, useClass: DomainRpcExceptionFilter }
 */
@Catch(NotFoundError)
export class DomainRpcExceptionFilter implements RpcExceptionFilter<NotFoundError> {
  catch(exception: NotFoundError, _host: ArgumentsHost): Observable<never> {
    return throwError(() => ({
      code: exception.code,
      message: exception.message,
    }));
  }
}
