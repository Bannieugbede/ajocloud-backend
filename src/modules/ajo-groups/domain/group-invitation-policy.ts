import { GroupInvitationStatus } from '../../../../generated/prisma/enums.js';

/**
 * How long an invitation link stays usable.
 *
 * Long enough to survive a weekend and a slow WhatsApp reply, short enough that
 * a link forwarded on months later has stopped working. An invite is a claim on
 * a slot in someone's group, so it should not outlive the conversation that
 * produced it.
 */
export const INVITATION_TTL_DAYS = 14;
export const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1_000;

/** Most invites go to one person; a link shared to a group chat needs more. */
export const MAX_INVITATION_USES = 100;

/**
 * Live invitations a single member may hold open at once.
 *
 * Without a cap, one member could mint unbounded rows against a group they
 * belong to. The limit is per issuer rather than per group so that one member
 * cannot exhaust the allowance for everyone else.
 */
export const MAX_LIVE_INVITATIONS_PER_MEMBER = 20;

/**
 * The status an invitation should be reported as right now.
 *
 * Expiry and exhaustion are facts about the row's own fields rather than events
 * anything writes, so a stored ACTIVE can be stale. Deriving the answer means a
 * caller is never shown a link as usable when redeeming it would fail.
 */
export function effectiveInvitationStatus(invitation: {
  readonly status: GroupInvitationStatus;
  readonly expiresAt: Date;
  readonly useCount: number;
  readonly maxUses: number;
  readonly now: Date;
}): GroupInvitationStatus {
  if (invitation.status !== GroupInvitationStatus.ACTIVE) return invitation.status;
  if (invitation.expiresAt <= invitation.now) return GroupInvitationStatus.EXPIRED;
  if (invitation.useCount >= invitation.maxUses) return GroupInvitationStatus.EXHAUSTED;
  return GroupInvitationStatus.ACTIVE;
}

/** Whether an invitation can still be redeemed. */
export function isRedeemable(invitation: {
  readonly status: GroupInvitationStatus;
  readonly expiresAt: Date;
  readonly useCount: number;
  readonly maxUses: number;
  readonly now: Date;
}): boolean {
  return effectiveInvitationStatus(invitation) === GroupInvitationStatus.ACTIVE;
}

/** Uses left on a live invitation; zero once it is spent or otherwise dead. */
export function remainingUses(invitation: {
  readonly status: GroupInvitationStatus;
  readonly expiresAt: Date;
  readonly useCount: number;
  readonly maxUses: number;
  readonly now: Date;
}): number {
  if (!isRedeemable(invitation)) return 0;
  return Math.max(0, invitation.maxUses - invitation.useCount);
}
