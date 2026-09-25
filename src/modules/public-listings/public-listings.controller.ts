import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { PublicListingsService } from './public-listings.service.js';

/**
 * What the website's sitemap lists. Unauthenticated because the sitemap is
 * built for crawlers; everything in it is already public at its own link.
 */
@ApiTags('public')
@Controller({ path: 'public/listings', version: '1' })
export class PublicListingsController {
  constructor(private readonly listings: PublicListingsService) {}

  @Get()
  @PublicEndpoint()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  list() {
    return this.listings.list();
  }
}
