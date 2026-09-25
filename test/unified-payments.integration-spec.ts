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
  FoodAjoStatus,
  FoodSubscriptionStatus,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PaymentTargetType,
  UserStatus,
} from '../generated/prisma/enums.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { AjoContributionTarget } from '../src/modules/ajo-groups/ajo-contribution.payment-target.js';
import { AjoSettlementService } from '../src/modules/ajo-groups/ajo-settlement.service.js';
import { FoodAjoProgrammesService } from '../src/modules/food-ajo/food-ajo-programmes.service.js';
import { FoodSubscriptionTarget } from '../src/modules/food-ajo/food-subscription.payment-target.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import type { TransactionalNotificationService } from '../src/modules/notifications/transactional-notification.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { AkawoPoolDueTarget } from '../src/modules/payments/targets/akawo-pool-due.target.js';
import { paymentTargetRegistry } from '../src/modules/payments/targets/payment-target.js';
import { WalletTopUpTarget } from '../src/modules/payments/targets/wallet-topup.target.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

/**
 * Proves that every product paid through the shared contract moves real money
 * to the right place, against real PostgreSQL.
 *
 * The unit tests prove each target's rules with a mocked ledger. What only shows
 * up here is whether the posting and the target's own record are written in
 * one transaction and agree with each other: the wallet falls by exactly what
 * the pool or escrow gains, and the schedule or enrolment says so.
 */
describeWithDatabase('Paying every product through one contract (PostgreSQL integration)', () => {
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
  const settlement = new AjoSettlementService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    { notify: jest.fn() } as unknown as TransactionalNotificationService,
  );
  const foodTarget = new FoodSubscriptionTarget(ledger);
  const payments = new PaymentsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    ledger,
    // The PIN has its own tests; here it always matches.
    { verifyPin: jest.fn().mockResolvedValue(undefined) } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { assess: jest.fn().mockResolvedValue({ amountMinor: 0n }) } as never,
    {} as never,
    paymentTargetRegistry(Object.values(PaymentTargetType), [
      new AkawoPoolDueTarget(),
      new AjoContributionTarget(settlement),
      foodTarget,
      new WalletTopUpTarget(),
    ]),
  );
  const food = new FoodAjoProgrammesService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    foodTarget,
  );

  const CONTRIBUTION = 1_000_000n; // ₦10,000
  const PACKAGE_PRICE = 2_500_000n; // ₦25,000
  const FUNDED = 20_000_000n; // ₦200,000

  let userId: string;
  let walletAccountId: string;
  let groupId: string;
  let scheduleId: string;
  let programmeId: string;
  let subscriptionId: string;

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

  /** Creates an intent and confirms it from the wallet, as the app does. */
  async function pay(targetType: PaymentTargetType, targetId: string, amountMinor?: bigint) {
    const intent = await payments.create(
      userId,
      {
        targetType,
        targetId,
        ...(amountMinor === undefined ? {} : { amountMinor: amountMinor.toString() }),
      },
      `create-${randomUUID()}`,
    );
    return payments.confirm(
      userId,
      intent.id,
      { method: 'WALLET', transactionPin: '1234' },
      `confirm-${randomUUID()}`,
    );
  }

  beforeAll(async () => {
    const suffix = randomUUID();

    const payable = await prisma.financialAccount.create({
      data: {
        code: `PLATFORM:PROVIDER_PAYABLE:NGN:${suffix}`,
        name: 'Provider payable',
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.PROVIDER_PAYABLE,
        currency: 'NGN',
      },
    });
    await prisma.financialAccount.create({
      data: {
        code: `PLATFORM:FEE_REVENUE:NGN:${suffix}`,
        name: 'Platform fee revenue',
        type: AccountType.REVENUE,
        purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
        currency: 'NGN',
      },
    });

    const user = await prisma.user.create({
      data: {
        email: `unified-${suffix}@example.test`,
        status: UserStatus.ACTIVE,
        wallets: { create: { currency: 'NGN' } },
      },
      include: { wallets: true },
    });
    userId = user.id;
    const wallet = user.wallets[0]!;
    walletAccountId = (
      await prisma.financialAccount.create({
        data: {
          code: `WALLET:${wallet.id}:AVAILABLE`,
          name: 'Wallet available',
          type: AccountType.LIABILITY,
          purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
          currency: 'NGN',
          walletId: wallet.id,
        },
      })
    ).id;
    // Funded the way a settled deposit would be, so the balance is real.
    await ledger.post({
      idempotencyKey: `test-fund:${suffix}`,
      reference: `TEST-FUND-${suffix}`,
      description: 'Test wallet funding',
      currency: 'NGN',
      entries: [
        { accountId: payable.id, direction: 'DEBIT', amountMinor: FUNDED },
        { accountId: walletAccountId, direction: 'CREDIT', amountMinor: FUNDED },
      ],
    });

    const group = await prisma.ajoGroup.create({
      data: {
        name: `Unified group ${suffix}`,
        status: AjoGroupStatus.ACTIVE,
        contributionFrequency: ContributionFrequency.MONTHLY,
        baseContributionMinor: CONTRIBUTION,
        maxSlots: 10,
        maxMembers: 10,
        minSlotsPerMember: 1,
        maxSlotsPerMember: 5,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-09-01'),
        createdByUserId: userId,
      },
    });
    groupId = group.id;
    const cycle = await prisma.ajoCycle.create({
      data: {
        groupId,
        sequence: 1,
        status: AjoCycleStatus.PENDING,
        contributionOpensAt: new Date('2026-09-25T00:00:00Z'),
        contributionDueAt: new Date('2099-10-01T00:00:00Z'),
        contributionClosesAt: new Date('2099-10-02T00:00:00Z'),
        graceEndsAt: new Date('2099-10-03T00:00:00Z'),
        payoutEligibilityCutoffAt: new Date('2099-10-04T00:00:00Z'),
        payoutDueAt: new Date('2099-10-05T00:00:00Z'),
        payoutProcessingEndsAt: new Date('2099-10-06T00:00:00Z'),
      },
    });
    const member = await prisma.ajoGroupMember.create({
      data: {
        groupId,
        userId,
        role: AjoMemberRole.GROUP_ADMIN,
        status: AjoMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
    const slot = await prisma.ajoSlot.create({
      data: { groupId, memberId: member.id, position: 1, status: AjoSlotStatus.ACTIVE },
    });
    scheduleId = (
      await prisma.contributionSchedule.create({
        data: {
          groupId,
          cycleId: cycle.id,
          slotId: slot.id,
          amountDueMinor: CONTRIBUTION,
          currency: 'NGN',
          dueAt: new Date('2099-10-01T00:00:00Z'),
          status: ContributionScheduleStatus.DUE,
          scheduleVersion: 1,
        },
      })
    ).id;

    const programme = await prisma.foodAjoGroup.create({
      data: {
        coordinatorUserId: randomUUID(),
        name: `Unified programme ${suffix}`,
        status: FoodAjoStatus.OPEN,
        contributionMinor: PACKAGE_PRICE,
        startsAt: new Date('2026-10-01'),
        endsAt: new Date('2026-12-01'),
        packages: {
          create: { name: 'Rice and beans', priceMinor: PACKAGE_PRICE, priceLockedAt: new Date() },
        },
      },
      include: { packages: true },
    });
    programmeId = programme.id;
    subscriptionId = (
      await prisma.foodSubscription.create({
        data: {
          groupId: programmeId,
          packageId: programme.packages[0]!.id,
          userId,
          quantity: 2,
          status: FoodSubscriptionStatus.PENDING,
        },
      })
    ).id;
  });

  afterAll(async () => prisma.$disconnect());

  describe('an Ajo contribution', () => {
    it('takes part of a round into the group pool, and leaves it part paid', async () => {
      const before = await balanceOf(walletAccountId);
      const part = 400_000n;

      const result = await pay(PaymentTargetType.AJO_CONTRIBUTION, scheduleId, part);

      expect(result.status).toBe('SUCCEEDED');
      expect(await balanceOf(walletAccountId)).toBe(before - part);
      const pool = await prisma.financialAccount.findUniqueOrThrow({
        where: { code: `AJO_GROUP:${groupId}:POOL` },
      });
      expect(await balanceOf(pool.id)).toBe(part);

      const schedule = await prisma.contributionSchedule.findUniqueOrThrow({
        where: { id: scheduleId },
      });
      expect(schedule.amountPaidMinor).toBe(part);
      expect(schedule.status).toBe(ContributionScheduleStatus.PARTIALLY_PAID);
      // Recorded the same way as a contribution paid through the Ajo route, so
      // payouts and statements see one kind of contribution.
      const contribution = await prisma.contribution.findFirstOrThrow({ where: { scheduleId } });
      expect(contribution.ledgerTransactionId).not.toBeNull();
    });

    it('settles the rest, which marks the round paid', async () => {
      await pay(PaymentTargetType.AJO_CONTRIBUTION, scheduleId);

      const schedule = await prisma.contributionSchedule.findUniqueOrThrow({
        where: { id: scheduleId },
      });
      expect(schedule.amountPaidMinor).toBe(CONTRIBUTION);
      expect(schedule.status).toBe(ContributionScheduleStatus.PAID);
    });

    it('refuses a further payment for a round already paid', async () => {
      await expect(pay(PaymentTargetType.AJO_CONTRIBUTION, scheduleId)).rejects.toThrow(
        'already been paid',
      );
    });
  });

  describe('a Food enrolment', () => {
    it('is paid in full into the programme’s escrow, which activates it', async () => {
      const before = await balanceOf(walletAccountId);

      const result = await pay(PaymentTargetType.FOOD_SUBSCRIPTION, subscriptionId);

      expect(result.amountMinor).toBe((PACKAGE_PRICE * 2n).toString());
      expect(await balanceOf(walletAccountId)).toBe(before - PACKAGE_PRICE * 2n);
      const escrow = await prisma.financialAccount.findUniqueOrThrow({
        where: { code: `FOOD_PROGRAMME:${programmeId}:ESCROW` },
      });
      expect(escrow.purpose).toBe(FinancialAccountPurpose.FOOD_PROGRAMME_ESCROW);
      expect(await balanceOf(escrow.id)).toBe(PACKAGE_PRICE * 2n);

      const subscription = await prisma.foodSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(subscription.status).toBe(FoodSubscriptionStatus.ACTIVE);
      expect(subscription.amountPaidMinor).toBe(PACKAGE_PRICE * 2n);
    });

    it('is refunded to the wallet when the member withdraws before buying begins', async () => {
      const before = await balanceOf(walletAccountId);

      await food.cancelSubscription(userId, programmeId);

      expect(await balanceOf(walletAccountId)).toBe(before + PACKAGE_PRICE * 2n);
      const escrow = await prisma.financialAccount.findUniqueOrThrow({
        where: { code: `FOOD_PROGRAMME:${programmeId}:ESCROW` },
      });
      expect(await balanceOf(escrow.id)).toBe(0n);
      const subscription = await prisma.foodSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(subscription.status).toBe(FoodSubscriptionStatus.CANCELLED);
      expect(subscription.amountPaidMinor).toBe(0n);
    });
  });
});
