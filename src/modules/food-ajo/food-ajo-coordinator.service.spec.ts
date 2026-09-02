import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { FoodAjoCoordinatorService } from './food-ajo-coordinator.service.js';

describe('FoodAjoCoordinatorService', () => {
  const prisma = {
    foodAjoGroup: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    foodSubscription: { groupBy: jest.fn() },
    foodPackage: { findMany: jest.fn() },
    purchaseOrder: { findMany: jest.fn() },
    foodDistribution: { findMany: jest.fn() },
    vendor: { findMany: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactions = { serializable: jest.fn() };
  const service = new FoodAjoCoordinatorService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
  );

  /** A programme owned by 'coordinator-id', in the given state. */
  const programme = (overrides: Record<string, unknown> = {}) => ({
    id: 'programme-id',
    coordinatorUserId: 'coordinator-id',
    status: 'DRAFT',
    currency: 'NGN',
    enrolmentCapacity: 50,
    activatedAt: null,
    packages: [{ id: 'package-id', priceMinor: 4_000_000n, isActive: true }],
    ...overrides,
  });

  const runInTransaction = (tx: Record<string, unknown>) =>
    transactions.serializable.mockImplementation(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    );

  beforeEach(() => jest.clearAllMocks());

  describe('ownership', () => {
    it('hides a programme coordinated by somebody else', async () => {
      const tx = { foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme()) } };
      runInTransaction(tx);
      await expect(
        service.transitionProgramme('another-user', 'programme-id', { status: 'OPEN' as never }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a programme that does not exist the same way', async () => {
      const tx = { foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(null) } };
      runInTransaction(tx);
      await expect(
        service.transitionProgramme('coordinator-id', 'programme-id', { status: 'OPEN' as never }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('opening a programme', () => {
    it('locks every unlocked package price', async () => {
      const tx = {
        foodAjoGroup: {
          findUnique: jest.fn().mockResolvedValue(programme()),
          update: jest.fn().mockResolvedValue({ id: 'programme-id', status: 'OPEN' }),
        },
        foodPackage: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.transitionProgramme('coordinator-id', 'programme-id', {
        status: 'OPEN' as never,
      });

      const locked = firstArg<{
        where: { groupId: string; priceLockedAt: null };
        data: { priceLockedAt: Date };
      }>(tx.foodPackage.updateMany);
      expect(locked.where).toEqual({ groupId: 'programme-id', priceLockedAt: null });
      expect(locked.data.priceLockedAt).toBeInstanceOf(Date);
    });

    it('refuses to open a programme with no active package', async () => {
      const tx = {
        foodAjoGroup: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              programme({ packages: [{ id: 'p', priceMinor: 4_000_000n, isActive: false }] }),
            ),
        },
      };
      runInTransaction(tx);
      await expect(
        service.transitionProgramme('coordinator-id', 'programme-id', { status: 'OPEN' as never }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('does not lock prices on any other transition', async () => {
      const tx = {
        foodAjoGroup: {
          findUnique: jest.fn().mockResolvedValue(programme({ status: 'OPEN' })),
          update: jest.fn().mockResolvedValue({ id: 'programme-id', status: 'ACTIVE' }),
        },
        foodPackage: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.transitionProgramme('coordinator-id', 'programme-id', {
        status: 'ACTIVE' as never,
      });
      expect(tx.foodPackage.updateMany).not.toHaveBeenCalled();
    });

    it('records when a programme first went live', async () => {
      const tx = {
        foodAjoGroup: {
          findUnique: jest.fn().mockResolvedValue(programme({ status: 'OPEN' })),
          update: jest.fn().mockResolvedValue({ id: 'programme-id', status: 'ACTIVE' }),
        },
        foodPackage: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.transitionProgramme('coordinator-id', 'programme-id', {
        status: 'ACTIVE' as never,
      });
      const activated = firstArg<{ data: { activatedAt?: Date } }>(tx.foodAjoGroup.update);
      expect(activated.data.activatedAt).toBeInstanceOf(Date);
    });

    it('does not rewrite when a resumed programme originally went live', async () => {
      const wentLive = new Date('2026-08-01T00:00:00.000Z');
      const tx = {
        foodAjoGroup: {
          findUnique: jest
            .fn()
            .mockResolvedValue(programme({ status: 'SUSPENDED', activatedAt: wentLive })),
          update: jest.fn().mockResolvedValue({ id: 'programme-id', status: 'ACTIVE' }),
        },
        foodPackage: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.transitionProgramme('coordinator-id', 'programme-id', {
        status: 'ACTIVE' as never,
      });
      // Resuming must leave the original activation date intact.
      const resumed = firstArg<{ data: { activatedAt?: Date } }>(tx.foodAjoGroup.update);
      expect(resumed.data.activatedAt).toBeUndefined();
    });

    it('refuses to complete a programme with uncollected items', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodDistributionItem: { count: jest.fn().mockResolvedValue(3) },
      };
      runInTransaction(tx);
      await expect(
        service.transitionProgramme('coordinator-id', 'programme-id', {
          status: 'COMPLETED' as never,
        }),
      ).rejects.toThrow(/3 member collections are still outstanding/);
    });
  });

  describe('package edits', () => {
    it('refuses to change a locked price', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme()) },
        foodPackage: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'package-id',
            groupId: 'programme-id',
            priceLockedAt: new Date(),
          }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.updatePackage('coordinator-id', 'programme-id', 'package-id', {
          priceMinor: '1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a package belonging to another programme', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme()) },
        foodPackage: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'package-id', groupId: 'other', priceLockedAt: null }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.updatePackage('coordinator-id', 'programme-id', 'package-id', { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('procurement plan', () => {
    it('sizes the order by enrolments, not by capacity', async () => {
      prisma.foodAjoGroup.findUnique.mockResolvedValue(programme({ status: 'ACTIVE' }));
      prisma.foodAjoGroup.findUniqueOrThrow.mockResolvedValue({
        id: 'programme-id',
        name: 'Family staples',
        status: 'ACTIVE',
        currency: 'NGN',
        enrolmentCapacity: 50,
      });
      // 50 places, but only 4 portions taken.
      prisma.foodSubscription.groupBy.mockResolvedValue([
        { packageId: 'package-id', _sum: { quantity: 4 }, _count: { _all: 3 } },
      ]);
      prisma.foodPackage.findMany.mockResolvedValue([
        {
          id: 'package-id',
          name: 'Rice and beans',
          priceMinor: 4_000_000n,
          isActive: true,
          items: [{ name: 'Rice', quantity: '10.000', unit: 'kg' }],
        },
      ]);

      const plan = (await service.procurementPlan('coordinator-id', 'programme-id')) as {
        totalPortions: number;
        expectedMinor: string;
        packages: { portions: number; items: { totalQuantity: string }[] }[];
      };

      expect(plan.totalPortions).toBe(4);
      expect(plan.expectedMinor).toBe('16000000');
      // The shopping list scales with portions taken: 4 x 10kg.
      expect(plan.packages[0]?.items[0]?.totalQuantity).toBe('40.000');
    });
  });

  describe('purchase orders', () => {
    it('refuses to order before the programme is active', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'OPEN' })) },
        foodSubscription: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 5 } }) },
      };
      runInTransaction(tx);
      await expect(
        service.createPurchaseOrder('coordinator-id', 'programme-id', {
          vendorId: 'vendor-id',
          items: [{ description: 'Rice', quantity: '40', unitPriceMinor: '100000' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an unverified vendor', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodSubscription: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 5 } }) },
        vendor: { findUnique: jest.fn().mockResolvedValue({ id: 'v', isVerified: false }) },
      };
      runInTransaction(tx);
      await expect(
        service.createPurchaseOrder('coordinator-id', 'programme-id', {
          vendorId: 'vendor-id',
          items: [{ description: 'Rice', quantity: '40', unitPriceMinor: '100000' }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('totals the order server-side from its lines', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodSubscription: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 5 } }) },
        vendor: { findUnique: jest.fn().mockResolvedValue({ id: 'v', isVerified: true }) },
        purchaseOrder: { create: jest.fn().mockResolvedValue({ id: 'order-id', items: [] }) },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.createPurchaseOrder('coordinator-id', 'programme-id', {
        vendorId: 'vendor-id',
        items: [
          { description: 'Rice', quantity: '40', unitPriceMinor: '100000' },
          { description: 'Oil', quantity: '2.5', unitPriceMinor: '80000' },
        ],
      });

      const order = firstArg<{ data: { totalMinor: bigint; currency: string } }>(
        tx.purchaseOrder.create,
      );
      // 40 x 1000.00 plus 2.5 x 800.00, totalled server-side from the lines.
      expect(order.data.totalMinor).toBe(4_200_000n);
      expect(order.data.currency).toBe('NGN');
    });

    it('will not mark an order fulfilled without a receipt', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        purchaseOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'order-id',
            status: 'CONFIRMED',
            foodAjoGroupId: 'programme-id',
            _count: { receipts: 0 },
          }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.transitionPurchaseOrder('coordinator-id', 'programme-id', 'order-id', {
          status: 'FULFILLED',
        }),
      ).rejects.toThrow(/receipt/i);
    });

    it('fulfils an order that has a receipt', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        purchaseOrder: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'order-id',
            status: 'CONFIRMED',
            foodAjoGroupId: 'programme-id',
            _count: { receipts: 1 },
          }),
          update: jest.fn().mockResolvedValue({ id: 'order-id', status: 'FULFILLED', items: [] }),
        },
        auditLog: { create: jest.fn() },
      };
      runInTransaction(tx);
      await expect(
        service.transitionPurchaseOrder('coordinator-id', 'programme-id', 'order-id', {
          status: 'FULFILLED',
        }),
      ).resolves.toEqual(expect.objectContaining({ status: 'FULFILLED' }));
    });

    it('refuses an order belonging to another programme', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        purchaseOrder: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'order-id', status: 'DRAFT', foodAjoGroupId: 'other' }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.transitionPurchaseOrder('coordinator-id', 'programme-id', 'order-id', {
          status: 'SUBMITTED',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('distribution', () => {
    it('builds the item list from the subscriptions, not from the client', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        purchaseOrder: { count: jest.fn().mockResolvedValue(1) },
        foodSubscription: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sub-1', quantity: 1 },
            { id: 'sub-2', quantity: 3 },
          ]),
        },
        foodDistribution: {
          create: jest.fn().mockResolvedValue({ id: 'distribution-id', items: [] }),
        },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.createDistribution('coordinator-id', 'programme-id', {
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const planned = firstArg<{
        data: { items: { create: { subscriptionId: string; quantity: number }[] } };
      }>(tx.foodDistribution.create);
      expect(planned.data.items.create).toEqual([
        { subscriptionId: 'sub-1', quantity: 1 },
        { subscriptionId: 'sub-2', quantity: 3 },
      ]);
    });

    it('refuses to plan a distribution with nothing procured', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
      };
      runInTransaction(tx);
      await expect(
        service.createDistribution('coordinator-id', 'programme-id', {
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('will not complete a distribution while members have not collected', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'DISTRIBUTING' }),
        },
        foodDistributionItem: { count: jest.fn().mockResolvedValue(2) },
      };
      runInTransaction(tx);
      await expect(
        service.transitionDistribution('coordinator-id', 'programme-id', 'd', {
          status: 'COMPLETED',
        }),
      ).rejects.toThrow(/2 members have not collected/);
    });
  });

  describe('collection codes', () => {
    it('returns the code once and stores only a digest', async () => {
      const upsert = jest.fn();
      const tx = {
        foodDistribution: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'distribution-id',
            groupId: 'programme-id',
            status: 'DISTRIBUTING',
            scheduledAt: new Date(),
          }),
        },
        foodSubscription: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
        foodDistributionItem: {
          findUnique: jest.fn().mockResolvedValue({ id: 'item-1', confirmation: null }),
        },
        distributionConfirmation: { upsert },
        auditLog: { create: jest.fn() },
      };
      runInTransaction(tx);

      const issued = (await service.issueCollectionCode('member-id', 'distribution-id')) as {
        code: string;
      };

      expect(issued.code).toHaveLength(6);
      const written = firstArg<{ create: { confirmationHash: string } }>(upsert);
      // The plain code must never reach the database.
      expect(written.create.confirmationHash).not.toBe(issued.code);
      expect(written.create.confirmationHash).toHaveLength(64);
    });

    it('refuses a code to somebody not enrolled', async () => {
      const tx = {
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'READY' }),
        },
        foodSubscription: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      runInTransaction(tx);
      await expect(
        service.issueCollectionCode('stranger-id', 'distribution-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a second code once the item has been collected', async () => {
      const tx = {
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'DISTRIBUTING' }),
        },
        foodSubscription: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
        foodDistributionItem: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'item-1', confirmation: { id: 'c', usedAt: new Date() } }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.issueCollectionCode('member-id', 'distribution-id'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a malformed code without touching the database', async () => {
      await expect(
        service.confirmCollection('coordinator-id', 'programme-id', 'd', { code: 'nope!' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(transactions.serializable).not.toHaveBeenCalled();
    });

    it('reports an expired code the same way as a wrong one', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'DISTRIBUTING' }),
        },
        distributionConfirmation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c',
            usedAt: null,
            expiresAt: new Date(Date.now() - 1_000),
            distributionItemId: 'item-1',
          }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.confirmCollection('coordinator-id', 'programme-id', 'd', { code: 'ABCDEF' }),
      ).rejects.toThrow('That collection code is not valid');
    });

    it('burns the code so it cannot be replayed', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'c', usedAt: new Date() });
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'DISTRIBUTING' }),
        },
        distributionConfirmation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c',
            usedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            distributionItemId: 'item-1',
          }),
          update,
        },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
      runInTransaction(tx);

      await service.confirmCollection('coordinator-id', 'programme-id', 'd', { code: 'ABCDEF' });
      const burnt = firstArg<{ data: { usedAt: Date } }>(update);
      expect(burnt.data.usedAt).toBeInstanceOf(Date);
    });

    it('refuses a code that was already used', async () => {
      const tx = {
        foodAjoGroup: { findUnique: jest.fn().mockResolvedValue(programme({ status: 'ACTIVE' })) },
        foodDistribution: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'd', groupId: 'programme-id', status: 'DISTRIBUTING' }),
        },
        distributionConfirmation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c',
            usedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            distributionItemId: 'item-1',
          }),
        },
      };
      runInTransaction(tx);
      await expect(
        service.confirmCollection('coordinator-id', 'programme-id', 'd', { code: 'ABCDEF' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('vendors', () => {
    it('creates a proposed vendor unverified', async () => {
      prisma.vendor.create.mockResolvedValue({ id: 'v', name: 'Mile 12', isVerified: false });
      await service.proposeVendor('coordinator-id', { name: 'Mile 12 Market' });
      const proposed = firstArg<{ data: Record<string, unknown> }>(prisma.vendor.create);
      // Verification is a platform decision, so the route must not set it.
      expect(proposed.data).not.toHaveProperty('isVerified');
    });
  });
});
