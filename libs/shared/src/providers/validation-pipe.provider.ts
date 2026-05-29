import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

/**
 * Shared global ValidationPipe provider.
 *
 * Registered via APP_PIPE so it applies to every incoming request/message in
 * whichever app includes it — defined once here so all services share the exact
 * same validation behaviour:
 *   - transform: payloads are turned into DTO class instances
 *   - whitelist: properties not in the DTO are stripped
 *   - forbidNonWhitelisted: unexpected properties throw instead of being ignored
 *     (only meaningful together with whitelist)
 *
 * Usage: add `validationPipeProvider` to a module's `providers` array.
 */
export const validationPipeProvider: Provider = {
  provide: APP_PIPE,
  useValue: new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
};
