import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { CreateSupportInquiryDto, JoinWaitlistDto } from './dto/join-waitlist.dto.js';

/**
 * Outcome of a waitlist submission. Re-submitting an address is a normal thing
 * for someone to do — they forget, or they want to update a typo'd phone — so
 * it is reported as a successful state rather than a conflict. The caller needs
 * to tell the two apart to say "you're on the list" instead of "welcome".
 */
export interface JoinWaitlistResult {
  readonly id: string;
  readonly email: string;
  readonly status: 'JOINED' | 'ALREADY_JOINED';
  /** When the address first joined, so the UI can say how long they've waited. */
  readonly joinedAt: string;
}

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent by email: a repeat submission refreshes the contact details and
   * reports `ALREADY_JOINED` rather than failing. Nobody loses their place, and
   * a duplicate never surfaces to the visitor as an error.
   */
  async joinWaitlist(dto: JoinWaitlistDto): Promise<JoinWaitlistResult> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.waitlistEntry.findUnique({
      where: { email },
      select: { id: true, createdAt: true },
    });

    const entry = await this.prisma.waitlistEntry.upsert({
      where: { email },
      update: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone,
        wantsPromotions: dto.wantsPromotions,
        status: 'ACTIVE',
      },
      create: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        phone: dto.phone,
        wantsPromotions: dto.wantsPromotions,
      },
      select: { id: true, email: true, createdAt: true },
    });

    return {
      id: entry.id,
      email: entry.email,
      status: existing ? 'ALREADY_JOINED' : 'JOINED',
      joinedAt: (existing?.createdAt ?? entry.createdAt).toISOString(),
    };
  }

  async createSupportInquiry(dto: CreateSupportInquiryDto) {
    return this.prisma.supportInquiry.create({
      data: {
        name: dto.name,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone ?? null,
        subject: dto.subject,
        message: dto.message,
      },
    });
  }
}
