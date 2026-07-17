import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            timezone: true,
            locale: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User was not found');
    return user;
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<unknown> {
    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
        ...(dto.timezone ? { timezone: dto.timezone } : {}),
      },
      select: { firstName: true, lastName: true, avatarUrl: true, timezone: true, locale: true },
    });
  }
}
