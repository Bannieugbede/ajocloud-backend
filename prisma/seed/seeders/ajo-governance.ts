import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  GroupInvitationStatus,
  GroupReferralCodeStatus,
  ScheduleVersionReason,
  SwapApprovalDecision,
  SwapInitiatorType,
  SwapRequestStatus,
} from '../../../generated/prisma/enums.js';

/**
 * Ajo governance: schedule versions, invitations, referral codes, and swaps.
 *
 * Deterministic and clearly fake. The invitation and referral codes are seeded
 * as the same SHA-256 digests the service computes, so the plaintext codes below
 * genuinely work against `POST /ajo-groups/join` rather than only looking right
 * in the database.
 */

/** Plaintext codes a developer can actually use locally. */
export const SEEDED_INVITATION_CODE = 'AJOTEST-INVITE-2026';
export const SEEDED_REFERRAL_CODE = 'AJOTEST-REFERRAL-2026';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const GROUP_ID = '10000000-0000-4000-8000-000000000001';
const SCHEDULE_V1 = '11000000-0000-4000-8000-000000000001';
const SCHEDULE_V2 = '11000000-0000-4000-8000-000000000002';
const INVITATION_ID = '11000000-0000-4000-8000-000000000010';
const REFERRAL_ID = '11000000-0000-4000-8000-000000000011';
const SWAP_PENDING_ID = '11000000-0000-4000-8000-000000000020';
const SWAP_EXECUTED_ID = '11000000-0000-4000-8000-000000000021';

export async function seedAjoGovernance(prisma: PrismaClient): Promise<void> {
  const group = await prisma.ajoGroup.findUnique({ where: { id: GROUP_ID } });
  if (!group) return;

  const members = await prisma.ajoGroupMember.findMany({
    where: { groupId: GROUP_ID },
    orderBy: { createdAt: 'asc' },
    include: { slots: { orderBy: { position: 'asc' } } },
  });
  const admin = members[0];
  // Swaps need two distinct slots. Without them there is nothing coherent to
  // seed, so the seeder stops rather than inventing a malformed request.
  const slots = members.flatMap((member) => member.slots);
  if (!admin || slots.length < 2) return;

  const [fromSlot, toSlot] = slots;
  if (!fromSlot || !toSlot) return;

  // Two versions so the immutable-version chain is visible: the initial lock,
  // then the version an approved swap produced.
  await prisma.ajoScheduleVersion.upsert({
    where: { groupId_version: { groupId: GROUP_ID, version: 1 } },
    update: {},
    create: {
      id: SCHEDULE_V1,
      groupId: GROUP_ID,
      version: 1,
      reason: ScheduleVersionReason.INITIAL_LOCK,
      createdByUserId: admin.userId,
      snapshot: {
        positions: slots.map((slot) => ({ position: slot.position, slotId: slot.id })),
      },
    },
  });
  await prisma.ajoScheduleVersion.upsert({
    where: { groupId_version: { groupId: GROUP_ID, version: 2 } },
    update: {},
    create: {
      id: SCHEDULE_V2,
      groupId: GROUP_ID,
      version: 2,
      previousVersionId: SCHEDULE_V1,
      reason: ScheduleVersionReason.APPROVED_SWAP,
      createdByUserId: admin.userId,
      snapshot: {
        positions: [
          { position: toSlot.position, slotId: fromSlot.id },
          { position: fromSlot.position, slotId: toSlot.id },
        ],
      },
    },
  });

  await prisma.groupInvitation.upsert({
    where: { id: INVITATION_ID },
    update: { status: GroupInvitationStatus.ACTIVE },
    create: {
      id: INVITATION_ID,
      groupId: GROUP_ID,
      createdByMemberId: admin.id,
      tokenDigest: digest(SEEDED_INVITATION_CODE),
      status: GroupInvitationStatus.ACTIVE,
      maxUses: 25,
      useCount: 1,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  });

  await prisma.groupReferralCode.upsert({
    where: { id: REFERRAL_ID },
    update: { status: GroupReferralCodeStatus.ACTIVE },
    create: {
      id: REFERRAL_ID,
      groupId: GROUP_ID,
      ownerMemberId: admin.id,
      codeDigest: digest(SEEDED_REFERRAL_CODE),
      status: GroupReferralCodeStatus.ACTIVE,
      maxUses: 100,
      useCount: 3,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  });

  // A pending swap awaiting the counterparty, so the approval screen has
  // something to act on.
  await prisma.swapRequest.upsert({
    where: { id: SWAP_PENDING_ID },
    update: { status: SwapRequestStatus.PENDING },
    create: {
      id: SWAP_PENDING_ID,
      groupId: GROUP_ID,
      requestedByMemberId: admin.id,
      initiatedByUserId: admin.userId,
      initiatorType: SwapInitiatorType.MEMBER,
      fromSlotId: fromSlot.id,
      toSlotId: toSlot.id,
      originalFromPosition: fromSlot.position,
      originalToPosition: toSlot.position,
      proposedFromPosition: toSlot.position,
      proposedToPosition: fromSlot.position,
      status: SwapRequestStatus.PENDING,
      reason: 'School fees fall due before my original position.',
      previousScheduleVersion: 1,
      scheduleVersion: 1,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  });

  // A completed swap with its approval, showing the resulting version.
  await prisma.swapRequest.upsert({
    where: { id: SWAP_EXECUTED_ID },
    update: { status: SwapRequestStatus.EXECUTED },
    create: {
      id: SWAP_EXECUTED_ID,
      groupId: GROUP_ID,
      requestedByMemberId: admin.id,
      initiatedByUserId: admin.userId,
      initiatorType: SwapInitiatorType.ADMINISTRATOR,
      fromSlotId: toSlot.id,
      toSlotId: fromSlot.id,
      originalFromPosition: toSlot.position,
      originalToPosition: fromSlot.position,
      proposedFromPosition: fromSlot.position,
      proposedToPosition: toSlot.position,
      status: SwapRequestStatus.EXECUTED,
      reason: 'Both members agreed to exchange positions.',
      previousScheduleVersion: 1,
      scheduleVersion: 1,
      resultingScheduleVersion: 2,
      reviewedByUserId: admin.userId,
      reviewNotes: 'Both parties confirmed in writing.',
      decidedAt: new Date('2026-07-20T10:00:00Z'),
      executedAt: new Date('2026-07-20T10:05:00Z'),
    },
  });

  await prisma.swapApproval.upsert({
    where: {
      swapRequestId_approverMemberId: {
        swapRequestId: SWAP_EXECUTED_ID,
        approverMemberId: admin.id,
      },
    },
    update: {},
    create: {
      swapRequestId: SWAP_EXECUTED_ID,
      approverMemberId: admin.id,
      decision: SwapApprovalDecision.APPROVED,
      reason: 'Agreed.',
      decidedAt: new Date('2026-07-20T10:00:00Z'),
    },
  });
}
