import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  ContributionFrequency,
  FoodAjoStatus,
  FoodFulfilmentMethod,
  FoodSubscriptionStatus,
} from '../../../generated/prisma/enums.js';
import { demoUser, type DemoUsers } from './demo-members.js';

/**
 * Food Ajo programmes, their packages, and who has joined which.
 *
 * A programme is a coordinator buying in bulk for a group and distributing the
 * result, so each one here carries the package contents that make it worth
 * joining — a package with a price and no contents tells a prospective member
 * nothing about what they would receive.
 */

const DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

type PackagePlan = {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: bigint;
  readonly items: readonly { name: string; quantity: string; unit: string }[];
};

type ProgrammePlan = {
  readonly id: string;
  readonly coordinatorKey: string;
  readonly name: string;
  readonly status: FoodAjoStatus;
  readonly contributionMinor: bigint;
  readonly frequency: ContributionFrequency;
  readonly capacity: number;
  readonly fulfilment: FoodFulfilmentMethod;
  readonly distributionInDays: number;
  readonly packages: readonly PackagePlan[];
  /** Member key to the package they joined, and how many portions. */
  readonly subscribers: Readonly<Record<string, { packageIndex: number; quantity: number }>>;
};

const PROGRAMMES: readonly ProgrammePlan[] = [
  {
    id: '20000000-0000-4000-8000-000000000401',
    coordinatorKey: 'ngozi',
    name: 'Basic Family Package',
    status: FoodAjoStatus.ACTIVE,
    contributionMinor: 20_000_00n,
    frequency: ContributionFrequency.MONTHLY,
    capacity: 40,
    fulfilment: FoodFulfilmentMethod.PICKUP,
    distributionInDays: 9,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000411',
        name: 'Basic staples',
        priceMinor: 20_000_00n,
        items: [
          { name: 'Rice', quantity: '10', unit: 'kg' },
          { name: 'Beans', quantity: '5', unit: 'kg' },
          { name: 'Groundnut oil', quantity: '5', unit: 'litre' },
          { name: 'Garri', quantity: '4', unit: 'kg' },
          { name: 'Tomato paste', quantity: '12', unit: 'tin' },
        ],
      },
    ],
    // Chisom is enrolled here, so the tab has an active plan to show.
    subscribers: {
      chisom: { packageIndex: 0, quantity: 1 },
      amaka: { packageIndex: 0, quantity: 2 },
      fatima: { packageIndex: 0, quantity: 1 },
      tunde: { packageIndex: 0, quantity: 1 },
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000402',
    coordinatorKey: 'ade',
    name: 'Premium Family Package',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 35_000_00n,
    frequency: ContributionFrequency.MONTHLY,
    capacity: 30,
    fulfilment: FoodFulfilmentMethod.DELIVERY_OR_PICKUP,
    distributionInDays: 21,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000421',
        name: 'Premium with protein',
        priceMinor: 35_000_00n,
        items: [
          { name: 'Rice', quantity: '12', unit: 'kg' },
          { name: 'Beans', quantity: '6', unit: 'kg' },
          { name: 'Frozen chicken', quantity: '4', unit: 'kg' },
          { name: 'Dried fish', quantity: '2', unit: 'kg' },
          { name: 'Groundnut oil', quantity: '5', unit: 'litre' },
          { name: 'Yam tubers', quantity: '4', unit: 'piece' },
        ],
      },
      {
        id: '20000000-0000-4000-8000-000000000422',
        name: 'Premium half portion',
        priceMinor: 18_000_00n,
        items: [
          { name: 'Rice', quantity: '6', unit: 'kg' },
          { name: 'Frozen chicken', quantity: '2', unit: 'kg' },
          { name: 'Groundnut oil', quantity: '2.5', unit: 'litre' },
        ],
      },
    ],
    // Nearly full, so the list shows a programme close to its capacity.
    subscribers: {
      emeka: { packageIndex: 0, quantity: 1 },
      adebayo: { packageIndex: 1, quantity: 1 },
      ngozi: { packageIndex: 0, quantity: 2 },
      emekaj: { packageIndex: 0, quantity: 1 },
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000403',
    coordinatorKey: 'amaka',
    name: 'Weekly Market Basket',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 8_000_00n,
    frequency: ContributionFrequency.WEEKLY,
    capacity: 25,
    fulfilment: FoodFulfilmentMethod.PICKUP,
    distributionInDays: 3,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000431',
        name: 'Fresh weekly basket',
        priceMinor: 8_000_00n,
        items: [
          { name: 'Tomatoes', quantity: '3', unit: 'kg' },
          { name: 'Peppers', quantity: '2', unit: 'kg' },
          { name: 'Onions', quantity: '2', unit: 'kg' },
          { name: 'Leafy vegetables', quantity: '4', unit: 'bunch' },
        ],
      },
    ],
    // Nobody yet: the browse list needs a programme with places free.
    subscribers: {},
  },
];

export async function seedFoodDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  for (const plan of PROGRAMMES) {
    const coordinatorId = demoUser(users, plan.coordinatorKey);

    await prisma.foodAjoGroup.upsert({
      where: { id: plan.id },
      update: { status: plan.status },
      create: {
        id: plan.id,
        coordinatorUserId: coordinatorId,
        name: plan.name,
        status: plan.status,
        currency: 'NGN',
        contributionMinor: plan.contributionMinor,
        contributionFrequency: plan.frequency,
        enrolmentCapacity: plan.capacity,
        fulfilmentMethod: plan.fulfilment,
        startsAt: daysFromNow(-60),
        endsAt: daysFromNow(120),
        plannedProcurementAt: daysFromNow(plan.distributionInDays - 3),
        distributionAt: daysFromNow(plan.distributionInDays),
        activatedAt: daysFromNow(-59),
      },
    });

    for (const packagePlan of plan.packages) {
      await prisma.foodPackage.upsert({
        where: { id: packagePlan.id },
        update: {},
        create: {
          id: packagePlan.id,
          groupId: plan.id,
          name: packagePlan.name,
          priceMinor: packagePlan.priceMinor,
          currency: 'NGN',
          // Locked, because a package whose price can still move is not one a
          // member can commit to.
          priceLockedAt: daysFromNow(-58),
          isActive: true,
        },
      });

      const existingItems = await prisma.foodPackageItem.count({
        where: { packageId: packagePlan.id },
      });
      if (existingItems === 0) {
        await prisma.foodPackageItem.createMany({
          data: packagePlan.items.map((item) => ({
            packageId: packagePlan.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
          })),
        });
      }
    }

    for (const [key, subscription] of Object.entries(plan.subscribers)) {
      const userId = demoUser(users, key);
      const packageId = plan.packages[subscription.packageIndex]?.id;
      if (!packageId) continue;

      await prisma.foodSubscription.upsert({
        where: { groupId_userId_packageId: { groupId: plan.id, userId, packageId } },
        update: {},
        create: {
          groupId: plan.id,
          packageId,
          userId,
          status:
            plan.status === FoodAjoStatus.ACTIVE
              ? FoodSubscriptionStatus.ACTIVE
              : FoodSubscriptionStatus.PENDING,
          quantity: subscription.quantity,
          fulfilmentMethod:
            plan.fulfilment === FoodFulfilmentMethod.DELIVERY_OR_PICKUP
              ? FoodFulfilmentMethod.PICKUP
              : plan.fulfilment,
        },
      });
    }
  }
}
