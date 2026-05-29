import { lookup } from 'dns/promises';
import { isIP } from 'net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Returns true if the given IP address falls inside a private, loopback,
 * link-local, or otherwise non-routable range that an external scraper
 * should never be allowed to reach (SSRF protection).
 */
export function isPrivateIp(ip: string): boolean {
  // Normalise IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];

  const version = isIP(ip);

  if (version === 4) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved (224.0.0.0+)
    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
    return false;
  }

  // Not a valid IP literal — treat as unsafe.
  return true;
}

/**
 * Validates a target URL for scraping. Rejects non-http(s) schemes and any
 * host that resolves to a private/internal address (SSRF protection).
 * Throws UnsafeUrlError when the URL must not be fetched.
 */
export async function assertUrlIsSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new UnsafeUrlError(
      `Disallowed protocol "${parsed.protocol}". Only http and https are permitted.`,
    );
  }

  const hostname = parsed.hostname;

  // If the host is already an IP literal, check it directly.
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new UnsafeUrlError(`Target IP ${hostname} is not allowed`);
    }
    return;
  }

  // Otherwise resolve all addresses and reject if ANY is private
  // (defends against DNS records pointing at internal hosts).
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve host: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Host did not resolve: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new UnsafeUrlError(
        `Host ${hostname} resolves to a private address (${address}) and is not allowed`,
      );
    }
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
