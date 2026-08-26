import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicEndpoint } from '../../common/decorators/public-endpoint.decorator.js';
import { EngagementService } from './engagement.service.js';
import { CreateSupportInquiryDto, JoinWaitlistDto } from './dto/join-waitlist.dto.js';

@ApiTags('engagement')
@Controller({ path: 'engagement', version: '1' })
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  /**
   * Joining is idempotent, so this answers 200 rather than 201: a repeat
   * submission creates nothing, and the body says which case it was.
   */
  @Post('waitlist')
  @PublicEndpoint()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.engagement.joinWaitlist(dto);
  }

  @Post('support-inquiries')
  @PublicEndpoint()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createSupportInquiry(@Body() dto: CreateSupportInquiryDto) {
    return this.engagement.createSupportInquiry(dto);
  }
}
