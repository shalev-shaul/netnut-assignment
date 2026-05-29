import { IsBoolean, IsOptional, IsUrl } from 'class-validator';

export class CreateScrapeJobDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url must be a valid http(s) URL' },
  )
  url: string;

  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}
