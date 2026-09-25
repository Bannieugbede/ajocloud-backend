import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { FoodAjoProgrammesService } from './food-ajo-programmes.service.js';

/**
 * The unauthenticated face of a Food Ajo programme.
 *
 * A shared programme link lands on the website, usually for someone without
 * the app. This describes the programme and its packages so they can decide
 * before signing up. Only programmes open to members in the app are described.
 */
@ApiTags('food-ajo')
@Controller({ path: 'public/food-programmes', version: '1' })
export class PublicFoodProgrammesController {
  constructor(private readonly programmes: FoodAjoProgrammesService) {}

  /** By short code (ajocloud.com/f/<code>) or, for older links, by id. */
  @Get(':idOrCode')
  @PublicEndpoint()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('idOrCode') idOrCode: string) {
    return this.programmes.publicPreview(idOrCode);
  }
}
