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

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export class ScrapeFailedError extends Error {
  constructor(url: string) {
    super(`Failed to scrape url: ${url}`);
    this.name = 'ScrapeFailedError';
  }
}