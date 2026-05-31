export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Validates that the target is a well-formed URL before fetching.
 * Throws UnsafeUrlError (a permanent, non-retryable failure) when it isn't.
 */
export function assertUrlIsSafe(rawUrl: string): void {
  try {
    new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }
}

/**
 * Masks credentials in a proxy URL so they are never written to logs.
 * e.g. http://user:pass@host:8080 -> http://***:***@host:8080
 */
export function redactProxy(proxy?: string): string {
  if (!proxy) return '';
  try {
    const u = new URL(proxy);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '[redacted proxy]';
  }
}
