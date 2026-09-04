import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  AccountType,
  AjoCycleStatus,
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  ContributionFrequency,
  ContributionScheduleStatus,
  FinancialAccountPurpose,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PayoutScheduleStatus,
  UserStatus,
} from '../generated/prisma/enums.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import type { TransactionalNotificationService } from '../src/modules/notifications/transactional-notification.service.js';
import { AjoSettlementService } from '../src/modules/ajo-groups/ajo-settlement.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

/**
 * Proves money actually moves, against real PostgreSQL.
 *
 * The unit tests prove the rules in isolation with a mocked ledger. What only
 * shows up here is whether the postings balance, whether the pool arithmetic
 * survives a round trip through BigInt columns, and whether the solvency rule
 * from ADR-001 holds when the numbers are real rather than asserted.
 */
describeWithDatabase('Ajo contribution and payout settlement (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const transactions = {
    run: <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel
        .ReadCommitted,
    ) => prisma.$transaction(operation, { isolationLevel, maxWait: 15_000, timeout: 30_000 }),
    serializable: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 15_000,
        timeout: 30_000,
      }),
  };

  const ledger = new LedgerService(transactions as unknown as TransactionService);
  // Stubbed: delivery has its own tests, and these assert money movement. A
  // real provider here would also try to reach Expo from a test run.
  const notifications = {
    notify: jest.fn().mockResolvedValue({ inApp: true, pushed: 0 }),
  } as unknown as TransactionalNotificationService;

  const service = new AjoSettlementService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    notifications,
  );

  const CONTRIBUTION = 500_000n; // ₦5,000
  const SLOTS = 3;

  let groupId: string;
  let cycleId: string;
  let payoutScheduleId: string;
  /** userId -> { memberId, slotId, scheduleId, walletAccountId } */
  const members: {
    userId: string;
    memberId: string;
    slotId: string;
    scheduleId: string;
    walletAccountId: string;
  }[] = [];

  /** Funds a wallet the way a settled deposit would, so balances are real. */
  async function fundWallet(accountId: string, amountMinor: bigint) {
    const payable = await prisma.financialAccount.findFirstOrThrow({
      where: { purpose: FinancialAccountPurpose.PROVIDER_PAYABLE, currency: 'NGN' },
    });
    await ledger.post({
      idempotencyKey: `test-fund:${randomUUID()}`,
      reference: `TEST-FUND-${randomUUID()}`,
      description: 'Test wallet funding',
      currency: 'NGN',
      entries: [
        { accountId: payable.id, direction: 'DEBIT', amountMinor },
        { accountId, direction: 'CREDIT', amountMinor },
      ],
    });
  }

  async function balanceOf(accountId: string): Promise<bigint> {
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId, transaction: { status: LedgerTransactionStatus.POSTED } },
      select: { direction: true, amountMinor: true },
    });
    return entries.reduce(
      (total, entry) =>
        entry.direction === LedgerEntryDirection.CREDIT
          ? total + entry.amountMinor
          : total - entry.amountMinor,
      0n,
    );
  }

  beforeAll(async () => {
    const suffix = randomUUID();

    await prisma.financialAccount.create({
      data: {
        code: `PLATFORM:PROVIDER_PAYABLE:NGN:${suffix}`,
        name: 'Provider payable',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.PROVIDER_PAYABLE,
        currency: 'NGN',
      },
    });

    const group = await prisma.ajoGroup.create({
      data: {
        name: `Settlement group ${suffix}`,
        status: AjoGroupStatus.ACTIVE,
        contributionFrequency: ContributionFrequency.MONTHLY,
        baseContributionMinor: CONTRIBUTION,
        maxSlots: 10,
        maxMembers: 10,
        minSlotsPerMember: 1,
        maxSlotsPerMember: 5,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-09-01'),
        createdByUserId: randomUUID(),
      },
    });
    groupId = group.id;

    const cycle = await prisma.ajoCycle.create({
      data: {
        groupId,
        sequence: 1,
        status: AjoCycleStatus.PENDING,
        contributionOpensAt: new Date('2026-09-25T00:00:00Z'),
        contributionDueAt: new Date('2026-10-01T00:00:00Z'),
        contributionClosesAt: new Date('2026-10-02T00:00:00Z'),
        graceEndsAt: new Date('2026-10-03T00:00:00Z'),
        payoutEligibilityCutoffAt: new Date('2026-10-04T00:00:00Z'),
        payoutDueAt: new Date('2026-10-05T00:00:00Z'),
        payoutProcessingEndsAt: new Date('2026-10-06T00:00:00Z'),
      },
    });
    cycleId = cycle.id;

    for (let index = 0; index < SLOTS; index += 1) {
      const user = await prisma.user.create({
        data: {
          email: `settle-${index}-${suffix}@example.test`,
          status: UserStatus.ACTIVE,
          wallets: { create: { currency: 'NGN' } },
        },
        include: { wallets: true },
      });
      const wallet = user.wallets[0]!;
      const available = await prisma.financialAccount.create({
        data: {
          code: `WALLET:${wallet.id}:AVAILABLE`,
          name: 'Wallet available',
          type: AccountType.LIABILITY,
          purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
          currency: 'NGN',
          walletId: wallet.id,
        },
      });

      const member = await prisma.ajoGroupMember.create({
        data: {
          groupId,
          userId: user.id,
          role: index === 0 ? AjoMemberRole.GROUP_ADMIN : AjoMemberRole.MEMBER,
          status: AjoMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });
      const slot = await prisma.ajoSlot.create({
        data: {
          groupId,
          memberId: member.id,
          position: index + 1,
          status: AjoSlotStatus.ACTIVE,
        },
      });
      const schedule = await prisma.contributionSchedule.create({
        data: {
          groupId,
          cycleId,
          slotId: slot.id,
          amountDueMinor: CONTRIBUTION,
          currency: 'NGN',
          dueAt: new Date('2026-10-01T00:00:00Z'),
          status: ContributionScheduleStatus.DUE,
          scheduleVersion: 1,
        },
      });

      // Generously funded, so an insufficient-balance failure in these tests is
      // a real defect rather than a stingy fixture.
      await fundWallet(available.id, CONTRIBUTION * 10n);

      members.push({
        userId: user.id,
        memberId: member.id,
        slotId: slot.id,
        scheduleId: schedule.id,
        walletAccountId: available.id,
      });
    }

    // Slot 1 takes the first turn and receives the whole cycle.
    const payoutSchedule = await prisma.payoutSchedule.create({
      data: {
        groupId,
        cycleId,
        slotId: members[0]!.slotId,
        amountDueMinor: CONTRIBUTION * BigInt(SLOTS),
        currency: 'NGN',
        dueAt: new Date('2026-10-05T00:00:00Z'),
        status: PayoutScheduleStatus.READY,
        scheduleVersion: 1,
      },
    });
    payoutScheduleId = payoutSchedule.id;
  });

  afterAll(async () => prisma.$disconnect());

  it('moves a contribution from the member wallet into the group pool', async () => {
    const member = members[0]!;
    const before = await balanceOf(member.walletAccountId);

    await service.payContribution(member.userId, groupId, member.scheduleId, {
      amountMinor: CONTRIBUTION.toString(),
      idempotencyKey: `contrib-${member.scheduleId}`,
    });

    expect(await balanceOf(member.walletAccountId)).toBe(before - CONTRIBUTION);

    const pool = await prisma.financialAccount.findUniqueOrThrow({
      where: { code: `AJO_GROUP:${groupId}:POOL` },
    });
    expect(await balanceOf(pool.id)).toBe(CONTRIBUTION);
    expect(pool.walletId).toBeNull();
    expect(pool.type).toBe(AccountType.LIABILITY);
  });

  it('does not collect twice when the same request is retried', async () => {
    const member = members[0]!;
    const before = await balanceOf(member.walletAccountId);

    await service.payContribution(member.userId, groupId, member.scheduleId, {
      amountMinor: CONTRIBUTION.toString(),
      idempotencyKey: `contrib-${member.scheduleId}`,
    });

    expect(await balanceOf(member.walletAccountId)).toBe(before);
  });

  it('refuses to pay out while other members still owe', async () => {
    // Only one of three has paid. ADR-001 allows no float, so paying now would
    // spend a later recipient's turn to fund this one.
    await expect(
      service.executePayout(members[0]!.userId, groupId, payoutScheduleId),
    ).rejects.toThrow(/has not collected every contribution/i);

    const held = await prisma.payoutSchedule.findUniqueOrThrow({
      where: { id: payoutScheduleId },
    });
    expect(held.status).toBe(PayoutScheduleStatus.HELD);
  });

  it('tracks a part payment without marking the schedule paid', async () => {
    const member = members[1]!;
    const part = CONTRIBUTION / 2n;

    await service.payContribution(member.userId, groupId, member.scheduleId, {
      amountMinor: part.toString(),
      idempotencyKey: `contrib-part-${member.scheduleId}`,
    });

    const schedule = await prisma.contributionSchedule.findUniqueOrThrow({
      where: { id: member.scheduleId },
    });
    expect(schedule.status).toBe(ContributionScheduleStatus.PARTIALLY_PAID);
    expect(schedule.amountPaidMinor).toBe(part);
  });

  it('completes a part-paid schedule with the exact remainder', async () => {
    const member = members[1]!;
    const part = CONTRIBUTION / 2n;

    await service.payContribution(member.userId, groupId, member.scheduleId, {
      amountMinor: part.toString(),
      idempotencyKey: `contrib-rest-${member.scheduleId}`,
    });

    const schedule = await prisma.contributionSchedule.findUniqueOrThrow({
      where: { id: member.scheduleId },
    });
    expect(schedule.status).toBe(ContributionScheduleStatus.PAID);
    expect(schedule.amountPaidMinor).toBe(CONTRIBUTION);
  });

  it('pays the recipient the whole pool once the cycle is fully collected', async () => {
    const last = members[2]!;
    await service.payContribution(last.userId, groupId, last.scheduleId, {
      amountMinor: CONTRIBUTION.toString(),
      idempotencyKey: `contrib-${last.scheduleId}`,
    });

    const recipient = members[0]!;
    const before = await balanceOf(recipient.walletAccountId);
    const expected = CONTRIBUTION * BigInt(SLOTS);

    await service.executePayout(recipient.userId, groupId, payoutScheduleId);

    // The full pool, with nothing withheld: ADR-001's arithmetic depends on a
    // recipient getting exactly N x contribution.
    expect(await balanceOf(recipient.walletAccountId)).toBe(before + expected);

    const pool = await prisma.financialAccount.findUniqueOrThrow({
      where: { code: `AJO_GROUP:${groupId}:POOL` },
    });
    // The cycle is settled, so the pool is empty again.
    expect(await balanceOf(pool.id)).toBe(0n);
  });

  it('does not pay a second time when execution is retried', async () => {
    const recipient = members[0]!;
    const before = await balanceOf(recipient.walletAccountId);

    const again = await service.executePayout(recipient.userId, groupId, payoutScheduleId);

    expect(await balanceOf(recipient.walletAccountId)).toBe(before);
    expect(again).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('leaves every ledger transaction it wrote balanced', async () => {
    const postings = await prisma.ledgerTransaction.findMany({
      where: { correlationId: groupId },
      include: { entries: true },
    });
    expect(postings.length).toBeGreaterThan(0);

    for (const posting of postings) {
      const debits = posting.entries
        .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
        .reduce((total, entry) => total + entry.amountMinor, 0n);
      const credits = posting.entries
        .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
        .reduce((total, entry) => total + entry.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('refuses a contribution the wallet cannot cover', async () => {
    const suffix = randomUUID();
    const poorUser = await prisma.user.create({
      data: {
        email: `poor-${suffix}@example.test`,
        status: UserStatus.ACTIVE,
        wallets: { create: { currency: 'NGN' } },
      },
      include: { wallets: true },
    });
    const wallet = poorUser.wallets[0]!;
    await prisma.financialAccount.create({
      data: {
        code: `WALLET:${wallet.id}:AVAILABLE`,
        name: 'Wallet available',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        currency: 'NGN',
        walletId: wallet.id,
      },
    });

    const member = await prisma.ajoGroupMember.create({
      data: {
        groupId,
        userId: poorUser.id,
        role: AjoMemberRole.MEMBER,
        status: AjoMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
    const slot = await prisma.ajoSlot.create({
      data: { groupId, memberId: member.id, position: 9, status: AjoSlotStatus.ACTIVE },
    });
    const schedule = await prisma.contributionSchedule.create({
      data: {
        groupId,
        cycleId,
        slotId: slot.id,
        amountDueMinor: CONTRIBUTION,
        currency: 'NGN',
        dueAt: new Date('2026-10-01T00:00:00Z'),
        status: ContributionScheduleStatus.DUE,
        scheduleVersion: 1,
      },
    });

    await expect(
      service.payContribution(poorUser.id, groupId, schedule.id, {
        amountMinor: CONTRIBUTION.toString(),
        idempotencyKey: `contrib-poor-${schedule.id}`,
      }),
    ).rejects.toThrow(/does not have enough/i);

    // The refusal must leave nothing behind: no overdraft, no partial posting.
    const walletAccount = await prisma.financialAccount.findUniqueOrThrow({
      where: { code: `WALLET:${wallet.id}:AVAILABLE` },
    });
    expect(await balanceOf(walletAccount.id)).toBe(0n);
  });
});
