import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { firstArg, secondArg } from '../../common/testing/mock-arguments.js';
import { AjoSettlementService } from './ajo-settlement.service.js';

describe('AjoSettlementService', () => {
  const tx = {
    contributionSchedule: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    payoutSchedule: { findUnique: jest.fn(), update: jest.fn() },
    ajoGroupMember: { findUnique: jest.fn() },
    contribution: { findUnique: jest.fn(), create: jest.fn() },
    payout: { findUnique: jest.fn(), create: jest.fn() },
    financialAccount: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    wallet: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactions = {
    serializable: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
  };
  const ledger = {
    postWithin: jest.fn(),
    accountBalanceWithin: jest.fn(),
  };

  // The hold is written through prisma rather than the transaction client,
  // because throwing rolls that transaction back.
  const prisma = { payoutSchedule: { update: jest.fn() } };

  const service = new AjoSettlementService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger as unknown as LedgerService,
  );

  const schedule = {
    id: 'sched-1',
    groupId: 'group-1',
    cycleId: 'cycle-1',
    slotId: 'slot-1',
    amountDueMinor: 500_000n,
    amountPaidMinor: 0n,
    currency: 'NGN',
    dueAt: new Date('2026-10-01T00:00:00.000Z'),
    status: 'DUE',
    slot: { memberId: 'member-1' },
  };

  const payDto = { amountMinor: '500000', idempotencyKey: 'client-key-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.contributionSchedule.findUnique.mockResolvedValue(schedule);
    tx.ajoGroupMember.findUnique.mockResolvedValue({
      id: 'member-1',
      status: 'ACTIVE',
      role: 'GROUP_ADMIN',
      userId: 'user-1',
    });
    tx.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
    tx.financialAccount.findFirst.mockResolvedValue({ id: 'wallet-available-1' });
    tx.financialAccount.findUnique.mockResolvedValue({ id: 'pool-1', isActive: true });
    tx.contribution.findUnique.mockResolvedValue(null);
    tx.contribution.create.mockResolvedValue({ id: 'contrib-1', amountMinor: 500_000n });
    tx.contributionSchedule.update.mockResolvedValue({});
    tx.auditLog.create.mockResolvedValue({});
    ledger.accountBalanceWithin.mockResolvedValue(1_000_000n);
    ledger.postWithin.mockResolvedValue({ id: 'ledger-1', reference: 'AJO-CONTRIB-x' });
  });

  describe('payContribution', () => {
    it('debits the member wallet and credits the group pool', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);

      const command = secondArg<{
        entries: { accountId: string; direction: string; amountMinor: bigint }[];
      }>(ledger.postWithin);
      expect(command.entries).toEqual([
        { accountId: 'wallet-available-1', direction: 'DEBIT', amountMinor: 500_000n },
        { accountId: 'pool-1', direction: 'CREDIT', amountMinor: 500_000n },
      ]);
    });

    it('charges no fee, because the deposit already paid one', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      const command = secondArg<{ entries: { amountMinor: bigint }[] }>(ledger.postWithin);
      // Exactly two entries: any fee split would add a third.
      expect(command.entries).toHaveLength(2);
    });

    it('refuses when the wallet cannot cover it, rather than overdrawing', async () => {
      // An overdrawn member wallet is a platform float by another name, which
      // ADR-001 forbids.
      ledger.accountBalanceWithin.mockResolvedValue(400_000n);
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('accepts a balance exactly equal to the contribution', async () => {
      ledger.accountBalanceWithin.mockResolvedValue(500_000n);
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).resolves.toBeDefined();
    });

    it('reads the balance inside the same transaction it posts in', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      // Both must see the same client, or a balance checked and then spent by a
      // concurrent request could still overdraw.
      expect(firstArg(ledger.accountBalanceWithin)).toBe(tx);
      expect(firstArg(ledger.postWithin)).toBe(tx);
    });

    it('refuses to pay another member’s contribution', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-2', status: 'ACTIVE' });
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('refuses a caller who is not an active member', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-1', status: 'EXITED' });
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a schedule belonging to another group', async () => {
      tx.contributionSchedule.findUnique.mockResolvedValue({ ...schedule, groupId: 'other' });
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([['WAIVED'], ['CANCELLED']])('refuses to collect a %s schedule', async (status) => {
      tx.contributionSchedule.findUnique.mockResolvedValue({ ...schedule, status });
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses more than is still owed', async () => {
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', {
          ...payDto,
          amountMinor: '600000',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('returns the existing contribution rather than posting twice', async () => {
      tx.contribution.findUnique.mockResolvedValue({ id: 'contrib-existing' });
      const result = await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      expect(result).toMatchObject({ id: 'contrib-existing' });
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('returns the contribution on retry even though the schedule is now settled', async () => {
      // A settled contribution has already moved amountPaidMinor to the full
      // amount, so validating the amount first would answer a legitimate retry
      // with "already paid in full" instead of the contribution it made.
      tx.contributionSchedule.findUnique.mockResolvedValue({
        ...schedule,
        amountPaidMinor: 500_000n,
        status: 'PAID',
      });
      tx.contribution.findUnique.mockResolvedValue({ id: 'contrib-existing' });

      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).resolves.toMatchObject({ id: 'contrib-existing' });
    });

    it('scopes the idempotency key to the schedule, not the client key alone', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      const command = secondArg<{ idempotencyKey: string }>(ledger.postWithin);
      expect(command.idempotencyKey).toBe('ajo-contribution:sched-1:client-key-1');
    });

    it('advances a fully paid schedule to PAID', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      const update = firstArg<{ data: { status: string; amountPaidMinor: bigint } }>(
        tx.contributionSchedule.update,
      );
      expect(update.data.status).toBe('PAID');
      expect(update.data.amountPaidMinor).toBe(500_000n);
    });

    it('leaves a part-paid schedule as PARTIALLY_PAID', async () => {
      await service.payContribution('user-1', 'group-1', 'sched-1', {
        ...payDto,
        amountMinor: '200000',
      });
      const update = firstArg<{ data: { status: string; amountPaidMinor: bigint } }>(
        tx.contributionSchedule.update,
      );
      expect(update.data.status).toBe('PARTIALLY_PAID');
      expect(update.data.amountPaidMinor).toBe(200_000n);
    });

    it('adds to what was already paid rather than replacing it', async () => {
      tx.contributionSchedule.findUnique.mockResolvedValue({
        ...schedule,
        amountPaidMinor: 300_000n,
        status: 'PARTIALLY_PAID',
      });
      await service.payContribution('user-1', 'group-1', 'sched-1', {
        ...payDto,
        amountMinor: '200000',
      });
      const update = firstArg<{ data: { status: string; amountPaidMinor: bigint } }>(
        tx.contributionSchedule.update,
      );
      expect(update.data.amountPaidMinor).toBe(500_000n);
      expect(update.data.status).toBe('PAID');
    });

    it('serialises BigInt money as strings', async () => {
      const result = await service.payContribution('user-1', 'group-1', 'sched-1', payDto);
      expect(result.amountMinor).toBe('500000');
    });
  });

  describe('executePayout', () => {
    const payoutSchedule = {
      id: 'payout-sched-1',
      groupId: 'group-1',
      cycleId: 'cycle-1',
      slotId: 'slot-1',
      amountDueMinor: 1_500_000n,
      currency: 'NGN',
      status: 'READY',
      slot: { memberId: 'member-1' },
    };

    beforeEach(() => {
      tx.payoutSchedule.findUnique.mockResolvedValue(payoutSchedule);
      tx.payoutSchedule.update.mockResolvedValue({});
      prisma.payoutSchedule.update.mockResolvedValue({});
      tx.payout.findUnique.mockResolvedValue(null);
      tx.payout.create.mockResolvedValue({ id: 'payout-1', amountMinor: 1_500_000n });
      tx.contributionSchedule.findMany.mockResolvedValue([
        { status: 'PAID' },
        { status: 'PAID' },
        { status: 'PAID' },
      ]);
      ledger.accountBalanceWithin.mockResolvedValue(1_500_000n);
    });

    it('debits the pool and credits the recipient wallet', async () => {
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      const command = secondArg<{
        entries: { accountId: string; direction: string; amountMinor: bigint }[];
      }>(ledger.postWithin);
      expect(command.entries).toEqual([
        { accountId: 'pool-1', direction: 'DEBIT', amountMinor: 1_500_000n },
        { accountId: 'wallet-available-1', direction: 'CREDIT', amountMinor: 1_500_000n },
      ]);
    });

    it('pays the full pool with no fee deducted', async () => {
      // ADR-001's arithmetic depends on it: N slots paying X yields exactly N*X.
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      const command = secondArg<{ entries: { amountMinor: bigint }[] }>(ledger.postWithin);
      expect(command.entries).toHaveLength(2);
      expect(command.entries[0]?.amountMinor).toBe(1_500_000n);
    });

    it.each([['PENDING'], ['DUE'], ['PARTIALLY_PAID'], ['OVERDUE']])(
      'refuses to pay out while a contribution is %s',
      async (status) => {
        tx.contributionSchedule.findMany.mockResolvedValue([{ status: 'PAID' }, { status }]);
        await expect(
          service.executePayout('user-1', 'group-1', 'payout-sched-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(ledger.postWithin).not.toHaveBeenCalled();
      },
    );

    it('holds the schedule rather than failing it when a cycle is short', async () => {
      tx.contributionSchedule.findMany.mockResolvedValue([{ status: 'OVERDUE' }]);
      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      // Written outside the rolled-back transaction, or the hold would vanish
      // with everything else and leave the schedule looking ready.
      const update = firstArg<{ data: { status: string } }>(prisma.payoutSchedule.update);
      expect(update.data.status).toBe('HELD');
      expect(tx.payoutSchedule.update).not.toHaveBeenCalled();
    });

    it('lets a held payout proceed once the arrears are settled', async () => {
      tx.payoutSchedule.findUnique.mockResolvedValue({ ...payoutSchedule, status: 'HELD' });
      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).resolves.toBeDefined();
    });

    it('refuses when the pool is short even if the schedules look settled', async () => {
      // The second guard: the schedule check is the business rule and could be
      // wrong; this one is the invariant that stops the platform funding a gap.
      ledger.accountBalanceWithin.mockResolvedValue(1_400_000n);
      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('reads the pool balance inside the transaction it posts in', async () => {
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      expect(firstArg(ledger.accountBalanceWithin)).toBe(tx);
      expect(firstArg(ledger.postWithin)).toBe(tx);
    });

    it('refuses a caller who is not the group administrator', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({
        id: 'member-1',
        status: 'ACTIVE',
        role: 'MEMBER',
      });
      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a payout schedule belonging to another group', async () => {
      tx.payoutSchedule.findUnique.mockResolvedValue({ ...payoutSchedule, groupId: 'other' });
      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([['PAID'], ['PROCESSING'], ['CANCELLED']])(
      'refuses a %s schedule so a replay cannot pay twice',
      async (status) => {
        tx.payoutSchedule.findUnique.mockResolvedValue({ ...payoutSchedule, status });
        await expect(
          service.executePayout('user-1', 'group-1', 'payout-sched-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('returns the existing payout rather than paying again', async () => {
      tx.payout.findUnique.mockResolvedValue({ id: 'payout-existing' });
      const result = await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      expect(result).toMatchObject({ id: 'payout-existing' });
      expect(ledger.postWithin).not.toHaveBeenCalled();
    });

    it('returns the payout on retry even though the schedule now reads PAID', async () => {
      // A completed payout leaves its schedule PAID, so checking the status
      // before idempotency answers a legitimate retry with a conflict instead
      // of the payout it already made.
      tx.payoutSchedule.findUnique.mockResolvedValue({ ...payoutSchedule, status: 'PAID' });
      tx.payout.findUnique.mockResolvedValue({ id: 'payout-existing', status: 'SUCCEEDED' });

      await expect(
        service.executePayout('user-1', 'group-1', 'payout-sched-1'),
      ).resolves.toMatchObject({ id: 'payout-existing' });
    });

    it('derives the idempotency key from the schedule with no caller input', async () => {
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      const command = secondArg<{ idempotencyKey: string }>(ledger.postWithin);
      expect(command.idempotencyKey).toBe('ajo-payout:payout-sched-1');
    });

    it('marks the schedule paid for the full amount', async () => {
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      const update = firstArg<{ data: { status: string; amountPaidMinor: bigint } }>(
        tx.payoutSchedule.update,
      );
      expect(update.data.status).toBe('PAID');
      expect(update.data.amountPaidMinor).toBe(1_500_000n);
    });

    it('records who received the payout in the audit trail', async () => {
      await service.executePayout('user-1', 'group-1', 'payout-sched-1');
      const entry = firstArg<{ data: { action: string; metadata: Record<string, unknown> } }>(
        tx.auditLog.create,
      );
      expect(entry.data.action).toBe('ajo.payout.executed');
      expect(entry.data.metadata.recipientUserId).toBe('user-1');
    });
  });

  describe('pool account', () => {
    it('creates the pool as a liability with no wallet attached', async () => {
      tx.financialAccount.findUnique.mockResolvedValue(null);
      tx.financialAccount.create.mockResolvedValue({ id: 'pool-new', isActive: true });

      await service.payContribution('user-1', 'group-1', 'sched-1', payDto);

      const created = firstArg<{ data: Record<string, unknown> }>(tx.financialAccount.create);
      expect(created.data.type).toBe('LIABILITY');
      expect(created.data.purpose).toBe('AJO_GROUP_POOL');
      // A group is not a person: attaching a wallet would give it the withdraw
      // and spend capabilities that hang off one.
      expect(created.data.walletId).toBeUndefined();
      expect(created.data.code).toBe('AJO_GROUP:group-1:POOL');
    });

    it('refuses to move money through a deactivated pool', async () => {
      tx.financialAccount.findUnique.mockResolvedValue({ id: 'pool-1', isActive: false });
      await expect(
        service.payContribution('user-1', 'group-1', 'sched-1', payDto),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
