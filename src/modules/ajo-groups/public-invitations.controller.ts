import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { GroupInvitationsService } from './group-invitations.service.js';

/**
 * Rate limited more tightly than an authenticated read: these take a secret in
 * the path from anyone on the internet, so they are the one place an
 * invitation code could be guessed at scale.
 */
const PREVIEW_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

function previewOf(invitations: GroupInvitationsService, code: string) {
  // Length is checked before any lookup so a junk path costs no HMAC work.
  // 7 is a listed group's public code; 128 bounds a legacy invitation.
  if (!code || code.length < 7 || code.length > 128) {
    throw new BadRequestException('This invitation link is invalid');
  }
  return invitations.preview(code);
}

/**
 * The unauthenticated face of an Ajo group's link, ajocloud.com/g/<code>.
 *
 * Separate from the group controller because that one is guarded end to end,
 * and this must not be: whoever opens a shared link has, by definition, no
 * session — and may not have the app at all. The web page reads this to name
 * the group and the person who invited them, and to write the preview social
 * apps show when the link is pasted.
 */
@ApiTags('ajo-groups')
@Controller({ path: 'public/ajo-groups', version: '1' })
export class PublicAjoGroupsController {
  constructor(private readonly invitations: GroupInvitationsService) {}

  /** Describes the group behind an invitation, or a listed group's public code. */
  @Get(':code')
  @PublicEndpoint()
  @Throttle(PREVIEW_THROTTLE)
  preview(@Param('code') code: string) {
    return previewOf(this.invitations, code);
  }
}

/**
 * The original address of the same preview, from before short links. Kept so
 * a website deployed ahead of the API, or behind it, still renders.
 */
@ApiTags('invitations')
@Controller({ path: 'invitations', version: '1' })
export class PublicInvitationsController {
  constructor(private readonly invitations: GroupInvitationsService) {}

  @Get(':code')
  @PublicEndpoint()
  @Throttle(PREVIEW_THROTTLE)
  preview(@Param('code') code: string) {
    return previewOf(this.invitations, code);
  }
}
