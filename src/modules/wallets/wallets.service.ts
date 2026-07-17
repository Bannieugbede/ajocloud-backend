import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  FinancialAccountPurpose,
  LedgerEntryDirection,
  LedgerTransactionStatus,
} from '../../../generated/prisma/enums.js';

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

  async summary(userId: string, walletId: string): Promise<unknown> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: {
        id: true,
        currency: true,
        status: true,
        accounts: {
          where: {
            purpose: {
              in: [
                FinancialAccountPurpose.WALLET_AVAILABLE,
                FinancialAccountPurpose.WALLET_RESERVED,
              ],
            },
          },
          select: { id: true, purpose: true },
        },
      },
    });
    if (!wallet) throw new NotFoundException('Wallet was not found');
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        accountId: { in: wallet.accounts.map((account) => account.id) },
        transaction: { status: LedgerTransactionStatus.POSTED },
      },
      select: { accountId: true, direction: true, amountMinor: true },
    });
    const balance = (purpose: FinancialAccountPurpose) => {
      const ids = new Set(
        wallet.accounts
          .filter((account) => account.purpose === purpose)
          .map((account) => account.id),
      );
      return entries
        .filter((entry) => ids.has(entry.accountId))
        .reduce(
          (sum, entry) =>
            entry.direction === LedgerEntryDirection.CREDIT
              ? sum + entry.amountMinor
              : sum - entry.amountMinor,
          0n,
        )
        .toString();
    };
    return {
      id: wallet.id,
      currency: wallet.currency,
      status: wallet.status,
      availableMinor: balance(FinancialAccountPurpose.WALLET_AVAILABLE),
      reservedMinor: balance(FinancialAccountPurpose.WALLET_RESERVED),
    };
  }
}
