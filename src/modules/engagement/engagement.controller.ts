import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EngagementService } from './engagement.service.js';
import { CreateSupportInquiryDto, JoinWaitlistDto } from './dto/join-waitlist.dto.js';

@ApiTags('engagement')
@Controller({ path: 'engagement', version: '1' })
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Post('waitlist')
  joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.engagement.joinWaitlist(dto);
  }

  @Post('support-inquiries')
  createSupportInquiry(@Body() dto: CreateSupportInquiryDto) {
    return this.engagement.createSupportInquiry(dto);
  }
}
