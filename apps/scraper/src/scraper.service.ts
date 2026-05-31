import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { assertUrlIsSafe, redactProxy } from '@netnut/shared';

// Hard cap on how much HTML we will pull into memory per request (10 MB).
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchUrl(url: string, useProxy?: boolean): Promise<string> {
    // SSRF protection: reject non-http(s) schemes and hosts that resolve
    // to private / internal addresses before we ever open a socket.
    await assertUrlIsSafe(url);

    // The client only asks to *use* a proxy; the actual connection string is
    // operator config (PROXY_URL env / k8s Secret), never client-supplied.
    const proxyUrl = useProxy
      ? this.config.get<string>('PROXY_URL')?.trim()
      : undefined;

    if (useProxy && !proxyUrl) {
      // Honour the explicit intent: don't silently fall back to a direct
      // fetch (that would leak our real egress IP). Fail loudly instead.
      throw new Error(
        'useProxy was requested but no PROXY_URL is configured on the scraper',
      );
    }

    this.logger.log(
      `Fetching URL: ${url}${
        proxyUrl ? ` via proxy ${redactProxy(proxyUrl)}` : ''
      }`,
    );

    const config: AxiosRequestConfig = {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_CONTENT_BYTES,
      maxBodyLength: MAX_CONTENT_BYTES,
      // Don't auto-follow redirects to internal hosts blindly; keep it bounded.
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; NetnutScraper/1.0; +https://netnut.io)',
      },
    };

    if (proxyUrl) {
      // Pick the agent by TARGET scheme, not proxy scheme: https targets are
      // CONNECT-tunnelled (HttpsProxyAgent), http targets use absolute-URI
      // requests to the proxy (HttpProxyAgent). axios then selects the agent
      // matching the target's protocol. Setting both keeps redirects across
      // schemes correct. `proxy: false` disables axios's own proxy handling.
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      config.httpAgent = new HttpProxyAgent(proxyUrl);
      config.proxy = false;
    }

    const response = await axios.get(url, config);
    return response.data as string;
  }
}
