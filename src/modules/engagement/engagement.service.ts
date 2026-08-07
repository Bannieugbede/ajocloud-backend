import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { CreateSupportInquiryDto, JoinWaitlistDto } from './dto/join-waitlist.dto.js';

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async joinWaitlist(dto: JoinWaitlistDto) {
    return this.prisma.waitlistEntry.upsert({
      where: { email: dto.email.toLowerCase() },
      update: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        wantsPromotions: dto.wantsPromotions,
        status: 'ACTIVE',
      },
      create: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        wantsPromotions: dto.wantsPromotions,
      },
    });
  }

  async createSupportInquiry(dto: CreateSupportInquiryDto) {
    return this.prisma.supportInquiry.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone ?? null,
        subject: dto.subject,
        message: dto.message,
      },
    });
  }
}
