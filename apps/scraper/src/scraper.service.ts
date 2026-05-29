import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { assertUrlIsSafe, redactProxy } from '@app/shared';

// Hard cap on how much HTML we will pull into memory per request (10 MB).
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  async fetchUrl(url: string, proxy?: string): Promise<string> {
    // SSRF protection: reject non-http(s) schemes and hosts that resolve
    // to private / internal addresses before we ever open a socket.
    await assertUrlIsSafe(url);

    this.logger.log(
      `Fetching URL: ${url}${proxy ? ` via proxy ${redactProxy(proxy)}` : ''}`,
    );

    const config: any = {
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

    if (proxy) {
      config.httpsAgent = new HttpsProxyAgent(proxy);
      config.httpAgent = new HttpsProxyAgent(proxy);
      config.proxy = false;
    }

    const response = await axios.get(url, config);
    return response.data as string;
  }
}
