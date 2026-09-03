import { GroupInvitationStatus } from '../../../../generated/prisma/enums.js';
import {
  INVITATION_TTL_DAYS,
  MAX_INVITATION_USES,
  effectiveInvitationStatus,
  isRedeemable,
  remainingUses,
} from './group-invitation-policy.js';

const now = new Date('2026-09-03T12:00:00.000Z');
const live = {
  status: GroupInvitationStatus.ACTIVE,
  expiresAt: new Date('2026-09-10T12:00:00.000Z'),
  useCount: 0,
  maxUses: 1,
  now,
};

describe('effectiveInvitationStatus', () => {
  it('reports a live invitation as active', () => {
    expect(effectiveInvitationStatus(live)).toBe(GroupInvitationStatus.ACTIVE);
  });

  it('reports an invitation past its expiry as expired without the row being rewritten', () => {
    const status = effectiveInvitationStatus({
      ...live,
      expiresAt: new Date('2026-09-03T11:59:59.000Z'),
    });
    expect(status).toBe(GroupInvitationStatus.EXPIRED);
  });

  it('treats an invitation expiring exactly now as expired', () => {
    // The boundary matters: redeeming and describing must agree, and join uses
    // `expiresAt <= now`. Disagreeing here would show a usable link that fails.
    expect(effectiveInvitationStatus({ ...live, expiresAt: now })).toBe(
      GroupInvitationStatus.EXPIRED,
    );
  });

  it('reports a fully used invitation as exhausted', () => {
    expect(effectiveInvitationStatus({ ...live, useCount: 1, maxUses: 1 })).toBe(
      GroupInvitationStatus.EXHAUSTED,
    );
  });

  it('keeps a multi-use invitation active while uses remain', () => {
    expect(effectiveInvitationStatus({ ...live, useCount: 3, maxUses: 5 })).toBe(
      GroupInvitationStatus.ACTIVE,
    );
  });

  it('never revives a revoked invitation, whatever its counters say', () => {
    const status = effectiveInvitationStatus({
      ...live,
      status: GroupInvitationStatus.REVOKED,
    });
    expect(status).toBe(GroupInvitationStatus.REVOKED);
  });
});

describe('isRedeemable', () => {
  it.each([
    ['live', live, true],
    ['expired', { ...live, expiresAt: new Date('2026-01-01T00:00:00.000Z') }, false],
    ['exhausted', { ...live, useCount: 1 }, false],
    ['revoked', { ...live, status: GroupInvitationStatus.REVOKED }, false],
  ])('reports %s as redeemable=%s', (_label, invitation, expected) => {
    expect(isRedeemable(invitation)).toBe(expected);
  });
});

describe('remainingUses', () => {
  it('counts the uses left on a live invitation', () => {
    expect(remainingUses({ ...live, useCount: 2, maxUses: 5 })).toBe(3);
  });

  it('reports none left for an invitation that is dead for any other reason', () => {
    // A revoked link has uses on paper but none in practice; reporting the raw
    // subtraction would show "3 invites left" for a link that cannot be used.
    expect(remainingUses({ ...live, status: GroupInvitationStatus.REVOKED, maxUses: 5 })).toBe(0);
  });

  it('never reports a negative count if the counter somehow overshoots', () => {
    expect(remainingUses({ ...live, useCount: 9, maxUses: 5 })).toBe(0);
  });
});

describe('invitation limits', () => {
  it('expires links within a fortnight so a forwarded link goes stale', () => {
    expect(INVITATION_TTL_DAYS).toBeLessThanOrEqual(30);
  });

  it('caps how many people one link may admit', () => {
    expect(MAX_INVITATION_USES).toBeLessThanOrEqual(1_000);
  });
});
