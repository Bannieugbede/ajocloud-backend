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
 *
 * The set is modelled on the 2026-09-12 Food tab design: programmes run for a
 * stated number of months and are contributed to daily, and the larger ones
 * offer a tiered choice (a cheaper and a fuller package) rather than a single
 * take-it-or-leave-it price. The duration is not a column — it is `startsAt` to
 * `endsAt`, which is what the client reads to print "3 Months".
 */

const DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/**
 * Programmes seeded before 2026-09-12, removed on the next run.
 *
 * The seeder upserts by fixed id, so a programme that is simply dropped from
 * the list below would stay in the database forever — invisible in this file
 * and still listed in the app. Naming the retired ids is what actually deletes
 * them.
 */
const RETIRED_PROGRAMME_IDS: readonly string[] = [
  '20000000-0000-4000-8000-000000000401',
  '20000000-0000-4000-8000-000000000402',
  '20000000-0000-4000-8000-000000000403',
];

type PackagePlan = {
  readonly id: string;
  readonly name: string;
  /**
   * A photograph of the package. Unsplash's own CDN, pinned to a photo id and
   * asked for a fixed width, so the app is not handed a multi-megabyte
   * original over a Nigerian mobile connection. Every URL here was requested
   * once and confirmed to return 200 before being committed.
   */
  readonly imageUrl: string;
  readonly description: string;
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
  /** How long the programme runs, which is what the design shows as a badge. */
  readonly months: number;
  readonly distributionInDays: number;
  readonly packages: readonly PackagePlan[];
  /** Member key to the package they joined, and how many portions. */
  readonly subscribers: Readonly<Record<string, { packageIndex: number; quantity: number }>>;
};

const PROGRAMMES: readonly ProgrammePlan[] = [
  {
    id: '20000000-0000-4000-8000-000000000411',
    coordinatorKey: 'ngozi',
    name: 'QAMS December Rice & Chicken Bundle',
    status: FoodAjoStatus.ACTIVE,
    // ₦1,500 a day over a 30-day programme: ₦45,000 for the full bundle.
    contributionMinor: 1_500_00n,
    frequency: ContributionFrequency.DAILY,
    capacity: 50,
    fulfilment: FoodFulfilmentMethod.PICKUP,
    months: 1,
    distributionInDays: 16,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000511',
        name: 'December bundle',
        imageUrl:
          'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=70&auto=format&fit=crop',
        description: 'Rice, chicken and the trimmings for one December celebration',
        priceMinor: 45_000_00n,
        items: [
          { name: 'Rice', quantity: '25', unit: 'kg' },
          { name: 'Frozen chicken', quantity: '5', unit: 'kg' },
          { name: 'Vegetable oil', quantity: '5', unit: 'litre' },
          { name: 'Tomato paste', quantity: '12', unit: 'tin' },
          { name: 'Seasoning', quantity: '2', unit: 'pack' },
        ],
      },
    ],
    // Chisom is enrolled here, so the tab opens on an active card mid-way
    // through its schedule rather than an empty state.
    subscribers: {
      chisom: { packageIndex: 0, quantity: 1 },
      amaka: { packageIndex: 0, quantity: 1 },
      fatima: { packageIndex: 0, quantity: 2 },
      tunde: { packageIndex: 0, quantity: 1 },
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000412',
    coordinatorKey: 'ade',
    name: '3-Month Mini Provisions Plug',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 600_00n,
    frequency: ContributionFrequency.DAILY,
    capacity: 60,
    fulfilment: FoodFulfilmentMethod.DELIVERY_OR_PICKUP,
    months: 3,
    distributionInDays: 28,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000521',
        name: 'Silver',
        imageUrl:
          'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?w=800&q=70&auto=format&fit=crop',
        description: 'Rice 25kg, Beans 10kg, Palm Oil 5L + more',
        // ₦600/day across roughly 90 days.
        priceMinor: 54_000_00n,
        items: [
          { name: 'Rice', quantity: '25', unit: 'kg' },
          { name: 'Beans', quantity: '10', unit: 'kg' },
          { name: 'Palm oil', quantity: '5', unit: 'litre' },
          { name: 'Garri', quantity: '10', unit: 'kg' },
        ],
      },
      {
        id: '20000000-0000-4000-8000-000000000522',
        name: 'Gold',
        imageUrl:
          'https://images.unsplash.com/photo-1506806732259-39c2d0268443?w=800&q=70&auto=format&fit=crop',
        description: 'Everything in Silver, with protein and a fuller store',
        // ₦1,200/day across roughly 90 days.
        priceMinor: 108_000_00n,
        items: [
          { name: 'Rice', quantity: '50', unit: 'kg' },
          { name: 'Beans', quantity: '20', unit: 'kg' },
          { name: 'Palm oil', quantity: '10', unit: 'litre' },
          { name: 'Frozen chicken', quantity: '6', unit: 'kg' },
          { name: 'Dried fish', quantity: '3', unit: 'kg' },
          { name: 'Semovita', quantity: '10', unit: 'kg' },
        ],
      },
    ],
    // Both tiers taken, so the browse list shows a programme with a real split
    // between them rather than one tier nobody chose.
    subscribers: {
      emeka: { packageIndex: 1, quantity: 1 },
      adebayo: { packageIndex: 0, quantity: 1 },
      bode: { packageIndex: 0, quantity: 2 },
      emekaj: { packageIndex: 1, quantity: 1 },
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000413',
    coordinatorKey: 'amaka',
    name: '6-Month Family Essentials Mega Plug',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 900_00n,
    frequency: ContributionFrequency.DAILY,
    capacity: 80,
    fulfilment: FoodFulfilmentMethod.DELIVERY_OR_PICKUP,
    months: 6,
    distributionInDays: 45,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000531',
        name: 'Silver',
        imageUrl:
          'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=800&q=70&auto=format&fit=crop',
        description: 'Six months of the staples a family runs out of first',
        priceMinor: 162_000_00n,
        items: [
          { name: 'Rice', quantity: '50', unit: 'kg' },
          { name: 'Beans', quantity: '25', unit: 'kg' },
          { name: 'Vegetable oil', quantity: '10', unit: 'litre' },
          { name: 'Garri', quantity: '25', unit: 'kg' },
          { name: 'Tomato paste', quantity: '24', unit: 'tin' },
        ],
      },
      {
        id: '20000000-0000-4000-8000-000000000532',
        name: 'Gold',
        imageUrl:
          'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800&q=70&auto=format&fit=crop',
        description: 'The full six-month store, protein included',
        priceMinor: 288_000_00n,
        items: [
          { name: 'Rice', quantity: '100', unit: 'kg' },
          { name: 'Beans', quantity: '50', unit: 'kg' },
          { name: 'Vegetable oil', quantity: '20', unit: 'litre' },
          { name: 'Frozen chicken', quantity: '12', unit: 'kg' },
          { name: 'Dried fish', quantity: '6', unit: 'kg' },
          { name: 'Yam tubers', quantity: '20', unit: 'piece' },
        ],
      },
    ],
    subscribers: {
      fatima: { packageIndex: 0, quantity: 1 },
      ngozi: { packageIndex: 1, quantity: 1 },
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000414',
    coordinatorKey: 'bode',
    name: 'Weekly Market Basket',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 8_000_00n,
    frequency: ContributionFrequency.WEEKLY,
    capacity: 25,
    fulfilment: FoodFulfilmentMethod.PICKUP,
    months: 1,
    distributionInDays: 3,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000541',
        name: 'Fresh weekly basket',
        imageUrl:
          'https://images.unsplash.com/photo-1584473457409-ae5c91d7d8b1?w=800&q=70&auto=format&fit=crop',
        description: 'Fresh vegetables and peppers from the weekly market',
        priceMinor: 8_000_00n,
        items: [
          { name: 'Tomatoes', quantity: '3', unit: 'kg' },
          { name: 'Peppers', quantity: '2', unit: 'kg' },
          { name: 'Onions', quantity: '2', unit: 'kg' },
          { name: 'Leafy vegetables', quantity: '4', unit: 'bunch' },
        ],
      },
    ],
    // Nobody yet: the browse list needs a programme with every place free.
    subscribers: {},
  },
  {
    id: '20000000-0000-4000-8000-000000000415',
    coordinatorKey: 'tunde',
    name: '10-Month Bulk Grains Collective',
    status: FoodAjoStatus.OPEN,
    contributionMinor: 750_00n,
    frequency: ContributionFrequency.DAILY,
    capacity: 100,
    fulfilment: FoodFulfilmentMethod.PICKUP,
    months: 10,
    distributionInDays: 60,
    packages: [
      {
        id: '20000000-0000-4000-8000-000000000551',
        name: 'Grains store',
        imageUrl:
          'https://images.unsplash.com/photo-1607532941433-304659e8198a?w=800&q=70&auto=format&fit=crop',
        description: 'A full year of grains, bought at harvest prices',
        priceMinor: 225_000_00n,
        items: [
          { name: 'Rice', quantity: '100', unit: 'kg' },
          { name: 'Beans', quantity: '50', unit: 'kg' },
          { name: 'Millet', quantity: '25', unit: 'kg' },
          { name: 'Maize', quantity: '50', unit: 'kg' },
        ],
      },
    ],
    subscribers: {
      adebayo: { packageIndex: 0, quantity: 1 },
    },
  },
];

/**
 * Removes the programmes this file used to seed.
 *
 * Ordered by the schema's own constraints: subscriptions and package items
 * first, then packages, then the group. `FoodSubscription` and `FoodPackage`
 * are both `onDelete: Restrict` against the group, so deleting the group first
 * fails rather than cascading. A programme someone has actually been
 * distributed food from is left alone — `FoodDistribution` restricts too, and
 * unpicking a real distribution is not a seeder's job.
 */
async function removeRetiredProgrammes(prisma: PrismaClient): Promise<void> {
  for (const groupId of RETIRED_PROGRAMME_IDS) {
    const distributions = await prisma.foodDistribution.count({ where: { groupId } });
    if (distributions > 0) continue;

    await prisma.foodSubscription.deleteMany({ where: { groupId } });
    await prisma.foodPackageItem.deleteMany({ where: { package: { groupId } } });
    await prisma.foodPackage.deleteMany({ where: { groupId } });
    await prisma.foodAjoGroup.deleteMany({ where: { id: groupId } });
  }
}

export async function seedFoodDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  await removeRetiredProgrammes(prisma);

  for (const plan of PROGRAMMES) {
    const coordinatorId = demoUser(users, plan.coordinatorKey);
    // The programme started a third of the way into its run, so a member
    // opening the app sees a schedule in progress rather than one that begins
    // today. `endsAt` is what gives the design its duration badge.
    const elapsedDays = Math.round(plan.months * 30 * 0.45);
    const startsAt = daysFromNow(-elapsedDays);
    const endsAt = daysFromNow(plan.months * 30 - elapsedDays);

    await prisma.foodAjoGroup.upsert({
      where: { id: plan.id },
      update: {
        status: plan.status,
        name: plan.name,
        contributionMinor: plan.contributionMinor,
        contributionFrequency: plan.frequency,
        enrolmentCapacity: plan.capacity,
        fulfilmentMethod: plan.fulfilment,
        startsAt,
        endsAt,
        distributionAt: daysFromNow(plan.distributionInDays),
      },
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
        startsAt,
        endsAt,
        plannedProcurementAt: daysFromNow(plan.distributionInDays - 3),
        distributionAt: daysFromNow(plan.distributionInDays),
        activatedAt: daysFromNow(-elapsedDays + 1),
      },
    });

    for (const packagePlan of plan.packages) {
      await prisma.foodPackage.upsert({
        where: { id: packagePlan.id },
        // Updated as well as created, so re-seeding refreshes an image whose
        // URL has changed rather than leaving the first one in place.
        update: {
          name: packagePlan.name,
          imageUrl: packagePlan.imageUrl,
          description: packagePlan.description,
          priceMinor: packagePlan.priceMinor,
        },
        create: {
          id: packagePlan.id,
          groupId: plan.id,
          name: packagePlan.name,
          imageUrl: packagePlan.imageUrl,
          description: packagePlan.description,
          priceMinor: packagePlan.priceMinor,
          currency: 'NGN',
          // Locked, because a package whose price can still move is not one a
          // member can commit to.
          priceLockedAt: daysFromNow(-elapsedDays + 2),
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
