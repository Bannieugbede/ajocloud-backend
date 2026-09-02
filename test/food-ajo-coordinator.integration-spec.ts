import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { UserStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { FoodAjoCoordinatorService } from '../src/modules/food-ajo/food-ajo-coordinator.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

/**
 * Exercises the coordinator flow against real PostgreSQL. The unit tests prove
 * the rules; this proves the queries behind them — the grouped aggregates, the
 * nested writes, and the serializable transactions actually run.
 */
describeWithDatabase('Food Ajo coordinator tooling (PostgreSQL integration)', () => {
  // Each step is a serializable round trip, which is slower than Jest's default
  // allows when the database is not on localhost.
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
  const service = new FoodAjoCoordinatorService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
  );

  let coordinatorId: string;
  let memberId: string;
  let strangerId: string;
  let programmeId: string;
  let packageId: string;
  let subscriptionId: string;
  let vendorId: string;
  let unverifiedVendorId: string;
  let orderId: string;
  let distributionId: string;

  beforeAll(async () => {
    const suffix = randomUUID();
    const user = (email: string) =>
      prisma.user.create({ data: { email, status: UserStatus.ACTIVE } });
    [coordinatorId, memberId, strangerId] = await Promise.all([
      user(`coordinator-${suffix}@example.test`).then((row) => row.id),
      user(`member-${suffix}@example.test`).then((row) => row.id),
      user(`stranger-${suffix}@example.test`).then((row) => row.id),
    ]);

    const programme = await prisma.foodAjoGroup.create({
      data: {
        coordinatorUserId: coordinatorId,
        name: `Integration staples ${suffix}`,
        contributionMinor: 1_000_000n,
        enrolmentCapacity: 50,
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-12-01'),
        packages: {
          create: [
            {
              name: 'Rice and beans',
              priceMinor: 4_000_000n,
              items: { create: [{ name: 'Rice', quantity: '10.000', unit: 'kg' }] },
            },
          ],
        },
      },
      include: { packages: true },
    });
    programmeId = programme.id;
    packageId = programme.packages[0]!.id;

    const [verified, unverified] = await Promise.all([
      prisma.vendor.create({ data: { name: `Mile 12 ${suffix}`, isVerified: true } }),
      prisma.vendor.create({ data: { name: `Unknown ${suffix}` } }),
    ]);
    vendorId = verified.id;
    unverifiedVendorId = unverified.id;
  });

  afterAll(async () => prisma.$disconnect());

  it('hides a programme from someone who does not coordinate it', async () => {
    await expect(
      service.transitionProgramme(strangerId, programmeId, { status: 'OPEN' as never }),
    ).rejects.toThrow(/not found/i);
  });

  it('locks every package price when the programme opens', async () => {
    await service.transitionProgramme(coordinatorId, programmeId, { status: 'OPEN' as never });
    const locked = await prisma.foodPackage.findUniqueOrThrow({ where: { id: packageId } });
    expect(locked.priceLockedAt).not.toBeNull();
  });

  it('refuses to change a price a member may already have enrolled against', async () => {
    await expect(
      service.updatePackage(coordinatorId, programmeId, packageId, { priceMinor: '1' }),
    ).rejects.toThrow(/locked/i);
  });

  it('refuses to procure while enrolment is still open', async () => {
    await expect(
      service.createPurchaseOrder(coordinatorId, programmeId, {
        vendorId,
        items: [{ description: 'Rice', quantity: '40', unitPriceMinor: '100000' }],
      }),
    ).rejects.toThrow(/active/i);
  });

  it('sizes the procurement plan by portions enrolled, not by capacity', async () => {
    const subscription = await prisma.foodSubscription.create({
      data: { groupId: programmeId, packageId, userId: memberId, quantity: 4 },
    });
    subscriptionId = subscription.id;
    await service.transitionProgramme(coordinatorId, programmeId, { status: 'ACTIVE' as never });

    const plan = (await service.procurementPlan(coordinatorId, programmeId)) as {
      totalPortions: number;
      expectedMinor: string;
      packages: { items: { totalQuantity: string }[] }[];
    };
    // The programme holds 50 places but only 4 portions were taken.
    expect(plan.totalPortions).toBe(4);
    expect(plan.expectedMinor).toBe('16000000');
    expect(plan.packages[0]?.items[0]?.totalQuantity).toBe('40.000');
  });

  it('refuses an order to an unverified vendor', async () => {
    await expect(
      service.createPurchaseOrder(coordinatorId, programmeId, {
        vendorId: unverifiedVendorId,
        items: [{ description: 'Rice', quantity: '40', unitPriceMinor: '100000' }],
      }),
    ).rejects.toThrow(/verified/i);
  });

  it('totals an order server-side, including fractional quantities', async () => {
    const order = (await service.createPurchaseOrder(coordinatorId, programmeId, {
      vendorId,
      items: [
        { description: 'Rice', quantity: '40', unitPriceMinor: '100000' },
        { description: 'Oil', quantity: '2.5', unitPriceMinor: '80000' },
      ],
    })) as { id: string; totalMinor: string };
    orderId = order.id;
    // 40 x 1000.00 plus 2.5 x 800.00.
    expect(order.totalMinor).toBe('4200000');
  });

  it('will not mark an order fulfilled before a receipt exists', async () => {
    await service.transitionPurchaseOrder(coordinatorId, programmeId, orderId, {
      status: 'SUBMITTED',
    });
    await service.transitionPurchaseOrder(coordinatorId, programmeId, orderId, {
      status: 'CONFIRMED',
    });
    await expect(
      service.transitionPurchaseOrder(coordinatorId, programmeId, orderId, { status: 'FULFILLED' }),
    ).rejects.toThrow(/receipt/i);
  });

  it('fulfils the order once the receipt is recorded', async () => {
    await service.recordReceipt(coordinatorId, programmeId, orderId, {
      storageKey: `receipts/${randomUUID()}.pdf`,
      contentHash: 'a'.repeat(64),
      receivedAt: new Date().toISOString(),
    });
    const fulfilled = (await service.transitionPurchaseOrder(coordinatorId, programmeId, orderId, {
      status: 'FULFILLED',
    })) as { status: string };
    expect(fulfilled.status).toBe('FULFILLED');
  });

  it('builds the distribution list from the subscriptions', async () => {
    const distribution = (await service.createDistribution(coordinatorId, programmeId, {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    })) as { id: string; items: { subscriptionId: string }[] };
    distributionId = distribution.id;
    expect(distribution.items).toHaveLength(1);
    expect(distribution.items[0]?.subscriptionId).toBe(subscriptionId);
  });

  it('cannot hand out before the goods are marked ready', async () => {
    await expect(
      service.transitionDistribution(coordinatorId, programmeId, distributionId, {
        status: 'COMPLETED',
      }),
    ).rejects.toThrow(/cannot become/i);
  });

  it('issues a collection code to the member and stores only its digest', async () => {
    await service.transitionDistribution(coordinatorId, programmeId, distributionId, {
      status: 'READY',
    });
    await service.transitionDistribution(coordinatorId, programmeId, distributionId, {
      status: 'DISTRIBUTING',
    });

    await expect(service.issueCollectionCode(strangerId, distributionId)).rejects.toThrow(
      /not enrolled/i,
    );

    const issued = (await service.issueCollectionCode(memberId, distributionId)) as {
      code: string;
    };
    expect(issued.code).toHaveLength(6);

    const stored = await prisma.distributionConfirmation.findFirstOrThrow({
      where: { item: { distributionId } },
    });
    expect(stored.confirmationHash).not.toBe(issued.code);
    expect(stored.confirmationHash).toHaveLength(64);

    await expect(
      service.confirmCollection(coordinatorId, programmeId, distributionId, { code: 'ZZZZZZ' }),
    ).rejects.toThrow(/not valid/i);

    await service.confirmCollection(coordinatorId, programmeId, distributionId, {
      code: issued.code,
    });
    // The code is burnt on use, so a screenshot cannot be replayed.
    await expect(
      service.confirmCollection(coordinatorId, programmeId, distributionId, { code: issued.code }),
    ).rejects.toThrow(/already been confirmed/i);
  });

  it('completes the programme and refuses to reopen it', async () => {
    await service.transitionDistribution(coordinatorId, programmeId, distributionId, {
      status: 'COMPLETED',
    });
    await service.transitionProgramme(coordinatorId, programmeId, { status: 'COMPLETED' as never });
    const done = await prisma.foodAjoGroup.findUniqueOrThrow({ where: { id: programmeId } });
    expect(done.status).toBe('COMPLETED');

    await expect(
      service.transitionProgramme(coordinatorId, programmeId, { status: 'OPEN' as never }),
    ).rejects.toThrow(/cannot/i);
  });
});
