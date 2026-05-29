import { IsBoolean, IsOptional, IsUrl } from 'class-validator';

export class CreateScrapeJobDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url must be a valid http(s) URL' },
  )
  url: string;

  /**
   * Whether to route the fetch through the proxy configured on the Scraper
   * (PROXY_URL env / k8s Secret). The client only expresses intent — it never
   * supplies the proxy connection string.
   */
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}
