import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

export const validationPipeProvider: Provider = {
  provide: APP_PIPE,
  useValue: new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
};
