import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AkawoDueStatus,
  AkawoPoolMemberStatus,
  AkawoPoolStatus,
  PaymentStatus,
  SavingsGoalStatus,
  SavingsGoalType,
} from '../../../generated/prisma/enums.js';
import { DEMO_MEMBERS, demoUser, type DemoUsers } from './demo-members.js';

/**
 * Akawo goals and collection pools.
 *
 * Goals are personal savings; pools are one organiser collecting a fixed amount
 * from a named group (ADR-007). Both appear on the Akawo tab, and the goals are
 * also what the Home wallet card sums into its savings figure — so the totals
 * here are what that tile will show.
 */

const DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/**
 * Pools store only a digest of their join code, so the plaintext exists once at
 * creation and never in the database. The seed keeps that property: the codes
 * below are written down here, in a development-only file, precisely because
 * they cannot be recovered from the row.
 */
function joinCodeDigest(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

type GoalPlan = {
  readonly id: string;
  readonly ownerKey: string;
  readonly name: string;
  readonly type: SavingsGoalType;
  readonly targetMinor: bigint;
  readonly savedMinor: bigint;
  readonly status: SavingsGoalStatus;
  readonly targetInDays: number | null;
};

const GOALS: readonly GoalPlan[] = [
  {
    id: '30000000-0000-4000-8000-000000000201',
    ownerKey: 'chisom',
    name: 'Rent 2027',
    type: SavingsGoalType.TARGET,
    targetMinor: 1_200_000_00n,
    savedMinor: 180_000_00n,
    status: SavingsGoalStatus.ACTIVE,
    targetInDays: 300,
  },
  {
    id: '30000000-0000-4000-8000-000000000202',
    ownerKey: 'chisom',
    name: 'Emergency fund',
    type: SavingsGoalType.FLEXIBLE,
    targetMinor: 500_000_00n,
    savedMinor: 54_500_00n,
    status: SavingsGoalStatus.ACTIVE,
    targetInDays: null,
  },
  {
    id: '30000000-0000-4000-8000-000000000203',
    ownerKey: 'chisom',
    // A locked goal cannot be withdrawn from before maturity, so the screen has
    // a case where the balance is real but not yet available.
    name: 'School fees',
    type: SavingsGoalType.LOCKED,
    targetMinor: 400_000_00n,
    savedMinor: 400_000_00n,
    status: SavingsGoalStatus.COMPLETED,
    targetInDays: 45,
  },
  {
    id: '30000000-0000-4000-8000-000000000204',
    ownerKey: 'amaka',
    name: 'Shop expansion',
    type: SavingsGoalType.TARGET,
    targetMinor: 800_000_00n,
    savedMinor: 275_000_00n,
    status: SavingsGoalStatus.ACTIVE,
    targetInDays: 200,
  },
];

type PoolPlan = {
  readonly id: string;
  readonly organiserKey: string;
  readonly name: string;
  readonly purpose: string;
  readonly joinCode: string;
  readonly amountMinor: bigint;
  readonly referenceLabel: string;
  readonly dueInDays: number;
  readonly status: AkawoPoolStatus;
  /** Member key mapped to whether they have paid. */
  readonly members: Readonly<Record<string, boolean>>;
};

const POOLS: readonly PoolPlan[] = [
  {
    id: '30000000-0000-4000-8000-000000000301',
    organiserKey: 'emekaj',
    name: '2024/2025 Departmental Dues',
    purpose: 'Departmental dues for the academic session',
    joinCode: 'DEPT-DUES-2025',
    amountMinor: 5_000_00n,
    referenceLabel: 'Matric number',
    dueInDays: -6,
    status: AkawoPoolStatus.OPEN,
    // Chisom has paid this one, so the tab shows a settled membership.
    members: { chisom: true, adebayo: true, emeka: true, amaka: true, fatima: false, tunde: false },
  },
  {
    id: '30000000-0000-4000-8000-000000000302',
    organiserKey: 'bode',
    name: 'Faculty Week Contribution',
    purpose: 'Faculty week events and logistics',
    joinCode: 'FACULTY-WEEK-25',
    amountMinor: 3_000_00n,
    referenceLabel: 'Matric number',
    dueInDays: 10,
    status: AkawoPoolStatus.OPEN,
    // Chisom has not: this is the "Payments Due" banner on the Akawo tab and
    // the pending row on Home.
    members: { chisom: false, ngozi: true, ade: true },
  },
  {
    id: '30000000-0000-4000-8000-000000000303',
    organiserKey: 'amaka',
    name: 'Market Women Levy',
    purpose: 'Monthly association levy',
    joinCode: 'MARKET-LEVY-01',
    amountMinor: 2_000_00n,
    referenceLabel: 'Stall number',
    dueInDays: -30,
    // A closed pool, so the list has a finished case as well as live ones.
    status: AkawoPoolStatus.CLOSED,
    members: { amaka: true, fatima: true, tunde: true },
  },
];

export async function seedAkawoDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  for (const plan of GOALS) {
    const userId = demoUser(users, plan.ownerKey);
    await prisma.savingsGoal.upsert({
      where: { id: plan.id },
      update: { status: plan.status },
      create: {
        id: plan.id,
        userId,
        name: plan.name,
        type: plan.type,
        targetMinor: plan.targetMinor,
        currency: 'NGN',
        status: plan.status,
        ...(plan.targetInDays === null ? {} : { targetDate: daysFromNow(plan.targetInDays) }),
        ...(plan.type === SavingsGoalType.LOCKED && plan.targetInDays !== null
          ? { maturityAt: daysFromNow(plan.targetInDays) }
          : {}),
      },
    });

    // The saved figure is the sum of settled contributions rather than a column,
    // so it is seeded as the contributions that produced it. One row per goal
    // keeps the arithmetic obvious.
    await prisma.savingsContribution.upsert({
      where: { idempotencyKey: `seed:savings:${plan.id}` },
      update: {},
      create: {
        goalId: plan.id,
        amountMinor: plan.savedMinor,
        currency: 'NGN',
        status: PaymentStatus.SUCCEEDED,
        idempotencyKey: `seed:savings:${plan.id}`,
      },
    });
  }

  for (const plan of POOLS) {
    const organiserId = demoUser(users, plan.organiserKey);
    const pool = await prisma.akawoPool.upsert({
      where: { id: plan.id },
      update: { status: plan.status },
      create: {
        id: plan.id,
        organiserUserId: organiserId,
        name: plan.name,
        purpose: plan.purpose,
        amountMinor: plan.amountMinor,
        currency: 'NGN',
        status: plan.status,
        joinCodeDigest: joinCodeDigest(plan.joinCode),
        referenceLabel: plan.referenceLabel,
        dueAt: daysFromNow(plan.dueInDays),
        ...(plan.status === AkawoPoolStatus.CLOSED ? { closedAt: daysFromNow(-1) } : {}),
      },
    });

    for (const [key, paid] of Object.entries(plan.members)) {
      const userId = demoUser(users, key);
      const details = DEMO_MEMBERS.find((candidate) => candidate.key === key);
      const fullName = details ? `${details.firstName} ${details.lastName}` : key;

      const member = await prisma.akawoPoolMember.upsert({
        where: { poolId_userId: { poolId: pool.id, userId } },
        update: {},
        create: {
          poolId: pool.id,
          userId,
          fullName,
          // The reference is how an organiser recognises a member on their own
          // list, so it is shaped like the label asks for.
          reference: `${plan.referenceLabel.startsWith('Matric') ? 'MAT' : 'STL'}/${String(
            2000 + (Math.abs(hashKey(key)) % 900),
          )}`,
          status: AkawoPoolMemberStatus.ACTIVE,
          joinedAt: daysFromNow(plan.dueInDays - 20),
        },
      });

      const existingDue = await prisma.akawoPoolDue.findFirst({
        where: { poolId: pool.id, memberId: member.id },
        select: { id: true },
      });
      if (!existingDue) {
        await prisma.akawoPoolDue.create({
          data: {
            poolId: pool.id,
            memberId: member.id,
            amountMinor: plan.amountMinor,
            currency: 'NGN',
            status: paid ? AkawoDueStatus.PAID : AkawoDueStatus.PENDING,
            ...(paid ? { paidAt: daysFromNow(plan.dueInDays - 5) } : {}),
          },
        });
      }
    }
  }
}

/** A stable small number from a key, so seeded references do not move. */
function hashKey(key: string): number {
  let total = 0;
  for (const character of key) total = (total * 31 + character.charCodeAt(0)) | 0;
  return total;
}
