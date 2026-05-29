export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ServiceUnavailableError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(message = 'Service unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}
