import { UnsafeUrlError } from '../errors/errors';

export function assertUrlIsSafe(rawUrl: string): void {
  try {
    new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }
}
