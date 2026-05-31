import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { assertUrlIsSafe, redactProxy } from '@netnut/shared';

@Injectable()
export class ScraperService {
  private readonly proxyUrl: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxContentBytes: number;
  private readonly logger = new Logger(ScraperService.name);

  constructor(private readonly config: ConfigService) {
    this.proxyUrl = this.config.get<string>('PROXY_URL');
    this.requestTimeoutMs = this.config.get<number>('REQUEST_TIMEOUT_MS');
    this.maxContentBytes = this.config.get<number>('MAX_CONTENT_BYTES');
  }

  async fetchUrl(url: string, useProxy?: boolean): Promise<string> {
    assertUrlIsSafe(url);

    const proxyUrl = useProxy ? this.proxyUrl : undefined;

    if (useProxy && !proxyUrl) {
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
      timeout: this.requestTimeoutMs,
      maxContentLength: this.maxContentBytes,
      maxBodyLength: this.maxContentBytes,
      maxRedirects: 5,
      responseType: 'text',
    };

    if (proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      config.httpAgent = new HttpProxyAgent(proxyUrl);
      config.proxy = false;
    }

    const response = await axios.get(url, config);
    return response.data as string;
  }
}
