import { ArgumentsHost, Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { NotFoundError } from '../errors/errors';

@Catch(NotFoundError)
export class DomainRpcExceptionFilter implements RpcExceptionFilter<NotFoundError> {
  catch(exception: NotFoundError, _host: ArgumentsHost): Observable<never> {
    return throwError(() => ({
      code: exception.code,
      message: exception.message,
    }));
  }
}
