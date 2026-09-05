import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  AjoContributionMode,
  AjoCycleStatus,
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  AjoSlotStatus,
  ContributionFrequency,
  ContributionScheduleStatus,
  PayoutScheduleStatus,
} from '../../../generated/prisma/enums.js';
import { demoUser, type DemoUsers } from './demo-members.js';

/**
 * The Ajo groups behind the group list and the Home dashboard.
 *
 * Each group is a different state on purpose, because a demo where everything
 * looks the same proves nothing: one mid-rotation, one with a payout ready, one
 * nearly finished, and one flexible-unit group whose members hold different
 * numbers of slots. Between them they cover every branch the list and detail
 * screens can take.
 *
 * Dates are relative to when the seed runs, so "due in 2 days" stays true
 * tomorrow. A fixed date would quietly become an overdue backlog within a week.
 */

const DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY);
}

/** A cycle's window, derived from its due date so the fields stay consistent. */
function cycleWindow(dueAt: Date) {
  return {
    contributionDueAt: dueAt,
    contributionOpensAt: new Date(dueAt.getTime() - 7 * DAY),
    contributionClosesAt: dueAt,
    graceEndsAt: new Date(dueAt.getTime() + 2 * DAY),
    payoutEligibilityCutoffAt: new Date(dueAt.getTime() + 2 * DAY),
    payoutDueAt: new Date(dueAt.getTime() + 3 * DAY),
    payoutProcessingEndsAt: new Date(dueAt.getTime() + 4 * DAY),
  };
}

type GroupPlan = {
  readonly id: string;
  readonly name: string;
  readonly adminKey: string;
  readonly memberKeys: readonly string[];
  readonly status: AjoGroupStatus;
  readonly frequency: ContributionFrequency;
  readonly contributionMinor: bigint;
  readonly mode: AjoContributionMode;
  /** Slots per member key, for the flexible group where they differ. */
  readonly slotsPerMember?: Readonly<Record<string, number>>;
  readonly maxSlots: number;
  /** Which round the rotation has reached. */
  readonly currentRound: number;
  /** Days until the next contribution falls due. */
  readonly nextDueInDays: number;
  /** Whether the viewer's payout is ready this cycle. */
  readonly payoutReady?: boolean;
};

/**
 * `chisom` is the account the demo signs in as, so they are a member of every
 * group — otherwise the dashboard would have nothing personal to show.
 */
const GROUPS: readonly GroupPlan[] = [
  {
    id: '10000000-0000-4000-8000-000000000101',
    name: 'Eko Savings Circle',
    adminKey: 'adebayo',
    memberKeys: ['adebayo', 'chisom', 'emeka', 'amaka', 'fatima', 'tunde'],
    status: AjoGroupStatus.ACTIVE,
    frequency: ContributionFrequency.MONTHLY,
    contributionMinor: 25_000_00n,
    mode: AjoContributionMode.FIXED,
    maxSlots: 12,
    currentRound: 3,
    nextDueInDays: 2,
  },
  {
    id: '10000000-0000-4000-8000-000000000102',
    name: 'Abuja Tech Circle',
    adminKey: 'emeka',
    memberKeys: ['emeka', 'chisom', 'ade', 'ngozi'],
    status: AjoGroupStatus.ACTIVE,
    frequency: ContributionFrequency.MONTHLY,
    contributionMinor: 50_000_00n,
    mode: AjoContributionMode.FIXED,
    maxSlots: 20,
    currentRound: 1,
    nextDueInDays: 4,
    // Chisom's turn: the dashboard shows money arriving rather than owed.
    payoutReady: true,
  },
  {
    id: '10000000-0000-4000-8000-000000000103',
    name: 'Lagos Women Save',
    adminKey: 'amaka',
    memberKeys: ['amaka', 'chisom', 'fatima', 'ngozi'],
    status: AjoGroupStatus.ACTIVE,
    frequency: ContributionFrequency.WEEKLY,
    contributionMinor: 10_000_00n,
    mode: AjoContributionMode.FIXED,
    maxSlots: 8,
    currentRound: 6,
    nextDueInDays: 9,
  },
  {
    id: '10000000-0000-4000-8000-000000000104',
    name: 'Ikoyi Premium Circle',
    adminKey: 'emekaj',
    memberKeys: ['emekaj', 'chisom', 'ade'],
    status: AjoGroupStatus.ACTIVE,
    frequency: ContributionFrequency.MONTHLY,
    contributionMinor: 50_000_00n,
    // Members hold different numbers of slots, so each owes a different amount
    // and the pool is larger than headcount times the base. See ADR-002.
    mode: AjoContributionMode.FLEXIBLE_UNIT,
    slotsPerMember: { emekaj: 3, chisom: 2, ade: 2 },
    maxSlots: 8,
    currentRound: 2,
    nextDueInDays: 16,
  },
];

export async function seedAjoDemo(prisma: PrismaClient, users: DemoUsers): Promise<void> {
  for (const plan of GROUPS) {
    const adminId = demoUser(users, plan.adminKey);

    const group = await prisma.ajoGroup.upsert({
      where: { id: plan.id },
      update: { status: plan.status },
      create: {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        contributionMode: plan.mode,
        contributionFrequency: plan.frequency,
        baseContributionMinor: plan.contributionMinor,
        ...(plan.mode === AjoContributionMode.FLEXIBLE_UNIT
          ? { contributionUnitMinor: plan.contributionMinor }
          : {}),
        currency: 'NGN',
        maxMembers: plan.maxSlots,
        maxSlots: plan.maxSlots,
        maxSlotsPerMember: 4,
        startDate: daysFromNow(-90),
        endDate: daysFromNow(275),
        createdByUserId: adminId,
        scheduleVersion: 1,
        lockedAt: daysFromNow(-89),
        activatedAt: daysFromNow(-89),
      },
    });

    // Members and their slots. Position determines payout order, so the slot
    // numbering here is what decides whose turn each round is.
    let position = 0;
    const slotsByMember = new Map<string, string[]>();

    for (const key of plan.memberKeys) {
      const userId = demoUser(users, key);
      const member = await prisma.ajoGroupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId } },
        update: {},
        create: {
          groupId: group.id,
          userId,
          role: key === plan.adminKey ? AjoMemberRole.GROUP_ADMIN : AjoMemberRole.MEMBER,
          status: AjoMemberStatus.ACTIVE,
          joinedAt: daysFromNow(-89),
        },
      });

      const slotCount = plan.slotsPerMember?.[key] ?? 1;
      const ids: string[] = [];
      for (let index = 0; index < slotCount; index += 1) {
        position += 1;
        const existing = await prisma.ajoSlot.findFirst({
          where: { groupId: group.id, position },
          select: { id: true },
        });
        const slot =
          existing ??
          (await prisma.ajoSlot.create({
            data: {
              groupId: group.id,
              memberId: member.id,
              position,
              status: AjoSlotStatus.ACTIVE,
            },
            select: { id: true },
          }));
        ids.push(slot.id);
      }
      slotsByMember.set(key, ids);
    }

    const allSlots = [...slotsByMember.values()].flat();

    // Two cycles: the one that has completed, and the one now open. That is
    // enough for the schedule screen to show history and a live obligation
    // without seeding a year of rounds nobody will scroll through.
    const previousDue = daysFromNow(plan.nextDueInDays - 30);
    const currentDue = daysFromNow(plan.nextDueInDays);

    for (const [offset, dueAt] of [previousDue, currentDue].entries()) {
      const sequence = plan.currentRound - 1 + offset;
      if (sequence < 1) continue;
      const isCurrent = offset === 1;

      const existingCycle = await prisma.ajoCycle.findFirst({
        where: { groupId: group.id, sequence },
        select: { id: true },
      });
      const cycle =
        existingCycle ??
        (await prisma.ajoCycle.create({
          data: {
            groupId: group.id,
            sequence,
            status: isCurrent ? AjoCycleStatus.OPEN : AjoCycleStatus.COMPLETED,
            ...cycleWindow(dueAt),
            openedAt: new Date(dueAt.getTime() - 7 * DAY),
            ...(isCurrent ? {} : { completedAt: new Date(dueAt.getTime() + 3 * DAY) }),
          },
          select: { id: true },
        }));

      for (const [index, slotId] of allSlots.entries()) {
        // The past cycle is fully paid; the current one is where the demo
        // lives, so Chisom's row is left outstanding and everyone else's is
        // settled. A cycle where nobody had paid would never show a payout.
        const isViewerSlot = slotsByMember.get('chisom')?.includes(slotId) ?? false;
        const paid = !isCurrent || !isViewerSlot;

        await prisma.contributionSchedule.upsert({
          where: { cycleId_slotId: { cycleId: cycle.id, slotId } },
          update: {},
          create: {
            groupId: group.id,
            cycleId: cycle.id,
            slotId,
            amountDueMinor: plan.contributionMinor,
            amountPaidMinor: paid ? plan.contributionMinor : 0n,
            currency: 'NGN',
            dueAt,
            status: paid ? ContributionScheduleStatus.PAID : ContributionScheduleStatus.DUE,
            scheduleVersion: 1,
          },
        });

        // One payout per cycle, to whichever slot's turn it is. The pool is the
        // whole cycle's contributions, which is what makes a rotation worth
        // joining: everyone pays one share and one member receives the lot.
        const payoutSlotIndex = (sequence - 1) % allSlots.length;
        if (index !== payoutSlotIndex) continue;

        const payoutSlot =
          plan.payoutReady && isCurrent ? (slotsByMember.get('chisom')?.[0] ?? slotId) : slotId;

        await prisma.payoutSchedule.upsert({
          where: {
            groupId_slotId_scheduleVersion: {
              groupId: group.id,
              slotId: payoutSlot,
              scheduleVersion: 1,
            },
          },
          update: {},
          create: {
            groupId: group.id,
            cycleId: cycle.id,
            slotId: payoutSlot,
            amountDueMinor: plan.contributionMinor * BigInt(allSlots.length),
            amountPaidMinor: isCurrent ? 0n : plan.contributionMinor * BigInt(allSlots.length),
            currency: 'NGN',
            dueAt: new Date(dueAt.getTime() + 3 * DAY),
            status: isCurrent
              ? plan.payoutReady
                ? PayoutScheduleStatus.READY
                : PayoutScheduleStatus.PENDING
              : PayoutScheduleStatus.PAID,
            scheduleVersion: 1,
          },
        });
      }
    }
  }
}
