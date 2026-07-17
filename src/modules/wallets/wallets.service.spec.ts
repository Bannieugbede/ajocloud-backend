import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { WalletsService } from './wallets.service.js';

describe('WalletsService', () => {
  const prisma = {
    wallet: { findFirst: jest.fn() },
    ledgerEntry: { findMany: jest.fn() },
  };
  const service = new WalletsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('derives available and reserved balances from posted owner wallet entries', async () => {
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'wallet-id',
      currency: 'NGN',
      status: 'ACTIVE',
      accounts: [
        { id: 'available-id', purpose: 'WALLET_AVAILABLE' },
        { id: 'reserved-id', purpose: 'WALLET_RESERVED' },
      ],
    });
    prisma.ledgerEntry.findMany.mockResolvedValue([
      { accountId: 'available-id', direction: 'CREDIT', amountMinor: 50_000n },
      { accountId: 'available-id', direction: 'DEBIT', amountMinor: 5_000n },
      { accountId: 'reserved-id', direction: 'CREDIT', amountMinor: 10_000n },
    ]);

    await expect(service.summary('user-id', 'wallet-id')).resolves.toEqual({
      id: 'wallet-id',
      currency: 'NGN',
      status: 'ACTIVE',
      availableMinor: '45000',
      reservedMinor: '10000',
    });
  });

  it('does not reveal another user wallet', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(service.summary('user-id', 'wallet-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
