import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<unknown[]> {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true, currency: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async transactions(userId: string, walletId: string): Promise<unknown[]> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException('Wallet was not found');
    return this.prisma.ledgerEntry.findMany({
      where: { account: { walletId } },
      select: {
        id: true,
        direction: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        transaction: {
          select: { reference: true, description: true, status: true, postedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
