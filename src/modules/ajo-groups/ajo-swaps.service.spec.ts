import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { AjoSwapsService } from './ajo-swaps.service.js';

describe('AjoSwapsService.list', () => {
  const prisma = {
    ajoGroupMember: { findUnique: jest.fn(), findMany: jest.fn() },
    swapRequest: { findMany: jest.fn() },
    ajoSlot: { findMany: jest.fn() },
    userProfile: { findMany: jest.fn() },
  };
  const transactions = { serializable: jest.fn() };
  const service = new AjoSwapsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
  );

  /** Ada owns slot-1, Bola owns slot-2; the caller is Ada unless overridden. */
  function arrange(
    swaps: Record<string, unknown>[],
    callerMemberId = 'member-ada',
    callerStatus = 'ACTIVE',
  ) {
    prisma.ajoGroupMember.findUnique.mockResolvedValue({
      id: callerMemberId,
      status: callerStatus,
    });
    prisma.swapRequest.findMany.mockResolvedValue(swaps);
    prisma.ajoSlot.findMany.mockResolvedValue([
      { id: 'slot-1', position: 1, memberId: 'member-ada' },
      { id: 'slot-2', position: 2, memberId: 'member-bola' },
    ]);
    prisma.ajoGroupMember.findMany.mockResolvedValue([
      { id: 'member-ada', userId: 'user-ada' },
      { id: 'member-bola', userId: 'user-bola' },
    ]);
    prisma.userProfile.findMany.mockResolvedValue([
      { userId: 'user-ada', firstName: 'Ada', lastName: 'Okafor' },
      { userId: 'user-bola', firstName: 'Bola', lastName: 'Adeyemi' },
    ]);
  }

  const pendingSwap = (overrides: Record<string, unknown> = {}) => ({
    id: 'swap-1',
    status: 'PENDING',
    initiatorType: 'MEMBER',
    requestedByMemberId: 'member-bola',
    fromSlotId: 'slot-2',
    toSlotId: 'slot-1',
    originalFromPosition: 2,
    originalToPosition: 1,
    proposedFromPosition: 1,
    proposedToPosition: 2,
    reason: 'Travelling in March',
    expiresAt: new Date(Date.now() + 3_600_000),
    decidedAt: null,
    executedAt: null,
    createdAt: new Date(),
    approvals: [],
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it('refuses a non-member', async () => {
    prisma.ajoGroupMember.findUnique.mockResolvedValue(null);
    await expect(service.list('stranger', 'group-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a member who is not active', async () => {
    prisma.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-x', status: 'SUSPENDED' });
    await expect(service.list('user-x', 'group-id')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('flags a pending swap that awaits the caller', async () => {
    arrange([pendingSwap()]);
    const result = (await service.list('user-ada', 'group-id')) as {
      awaitingMyDecision: boolean;
    }[];
    expect(result[0]?.awaitingMyDecision).toBe(true);
  });

  it('does not ask a member who already decided', async () => {
    arrange([
      pendingSwap({
        approvals: [
          {
            approverMemberId: 'member-ada',
            decision: 'APPROVED',
            reason: null,
            decidedAt: new Date(),
          },
        ],
      }),
    ]);
    const result = (await service.list('user-ada', 'group-id')) as {
      awaitingMyDecision: boolean;
    }[];
    expect(result[0]?.awaitingMyDecision).toBe(false);
  });

  it('does not ask someone who owns neither position', async () => {
    arrange([pendingSwap()], 'member-chidi');
    const result = (await service.list('user-chidi', 'group-id')) as {
      awaitingMyDecision: boolean;
    }[];
    expect(result[0]?.awaitingMyDecision).toBe(false);
  });

  it('reports an elapsed request as expired before the row is rewritten', async () => {
    arrange([pendingSwap({ expiresAt: new Date(Date.now() - 1_000) })]);
    const result = (await service.list('user-ada', 'group-id')) as {
      status: string;
      awaitingMyDecision: boolean;
    }[];
    expect(result[0]?.status).toBe('EXPIRED');
    // Never invite a decision the approve route would refuse.
    expect(result[0]?.awaitingMyDecision).toBe(false);
  });

  it('never asks for a decision on a settled swap', async () => {
    arrange([pendingSwap({ status: 'EXECUTED', executedAt: new Date() })]);
    const result = (await service.list('user-ada', 'group-id')) as {
      awaitingMyDecision: boolean;
    }[];
    expect(result[0]?.awaitingMyDecision).toBe(false);
  });

  it('names both positions without exposing anyone email address', async () => {
    arrange([pendingSwap()]);
    const result = (await service.list('user-ada', 'group-id')) as {
      from: { displayName: string; position: number };
      to: { displayName: string; position: number };
    }[];
    expect(result[0]?.from).toEqual(
      expect.objectContaining({ displayName: 'Bola Adeyemi', position: 2 }),
    );
    expect(result[0]?.to).toEqual(
      expect.objectContaining({ displayName: 'Ada Okafor', position: 1 }),
    );
    // The profile read must not select an email at all.
    const profileQuery = firstArg<{ select: Record<string, boolean> }>(prisma.userProfile.findMany);
    expect(profileQuery.select).toEqual({ userId: true, firstName: true, lastName: true });
  });

  it('falls back to a neutral label when a profile is missing', async () => {
    arrange([pendingSwap()]);
    prisma.userProfile.findMany.mockResolvedValue([]);
    const result = (await service.list('user-ada', 'group-id')) as {
      from: { displayName: string };
    }[];
    expect(result[0]?.from.displayName).toBe('Member');
  });
});
