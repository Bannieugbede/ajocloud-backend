import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { AkawoPoolsService } from './akawo-pools.service.js';

/**
 * The unauthenticated face of an Akawo pool's join code.
 *
 * Separate from the pools controller because that one is guarded end to end.
 * Whoever opens a shared pool link has no session and may not have the app,
 * and the web landing page reads this to name the pool, the amount and who is
 * collecting before asking them to sign up.
 */
@ApiTags('akawo-pools')
@Controller({ path: 'public/akawo-pools', version: '1' })
export class PublicAkawoPoolsController {
  constructor(private readonly pools: AkawoPoolsService) {}

  /**
   * Rate limited like the Ajo invitation preview: it takes a join code from
   * anyone on the internet, so it is where a code could be guessed at scale.
   * The service checks the code's shape before any lookup.
   */
  @Get(':joinCode')
  @PublicEndpoint()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(@Param('joinCode') joinCode: string) {
    return this.pools.publicPreview(joinCode);
  }
}
