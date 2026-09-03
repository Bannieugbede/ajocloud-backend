import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { GroupInvitationsService } from './group-invitations.service.js';

/**
 * The unauthenticated face of a group invitation.
 *
 * Separate from the group controller because that one is guarded end to end,
 * and this must not be: whoever opens an invitation link has, by definition,
 * no session — and may not have the app at all. The web landing page reads
 * this to name the group and the person who invited them.
 */
@ApiTags('invitations')
@Controller({ path: 'invitations', version: '1' })
export class PublicInvitationsController {
  constructor(private readonly invitations: GroupInvitationsService) {}

  /**
   * Describes the group behind an invitation code.
   *
   * Rate limited more tightly than an authenticated read: this endpoint takes a
   * secret in the path from anyone on the internet, so it is the one place an
   * invitation code could be guessed at scale.
   */
  @Get(':code')
  @PublicEndpoint()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(@Param('code') code: string) {
    // Length is checked before the digest so a junk path costs no HMAC work.
    if (!code || code.length < 32) {
      throw new BadRequestException('This invitation link is invalid');
    }
    return this.invitations.preview(code);
  }
}
