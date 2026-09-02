import { ForbiddenException } from '@nestjs/common';
import {
  acceptsSubscriptions,
  assertCanSubscribe,
  assertCoordinatorCanCreateProgramme,
  assertPackageActivation,
  canCancelSubscription,
  canConsumeDistributionToken,
  remainingCapacity,
} from './food-ajo-policy.js';

describe('Food Ajo controls', () => {
  it('prevents an unapproved coordinator from creating a programme', () => {
    expect(() =>
      assertCoordinatorCanCreateProgramme({
        applicationStatus: 'SUBMITTED',
        approvalExpiresAt: new Date(Date.now() + 1_000),
        kycTier: 'TIER_3',
      }),
    ).toThrow(ForbiddenException);
  });

  it('accepts a current approved Tier 3 coordinator', () => {
    expect(() =>
      assertCoordinatorCanCreateProgramme({
        applicationStatus: 'APPROVED',
        approvalExpiresAt: new Date(Date.now() + 60_000),
        kycTier: 'TIER_3',
      }),
    ).not.toThrow();
  });

  it('locks valid package economics within capacity', () => {
    expect(() =>
      assertPackageActivation({ priceMinor: 50_000n, capacity: 100, enrolled: 100 }),
    ).not.toThrow();
  });

  it('prevents collection token replay', () => {
    const now = new Date();
    expect(canConsumeDistributionToken({ expiresAt: new Date(now.getTime() + 1_000), now })).toBe(
      true,
    );
    expect(
      canConsumeDistributionToken({
        expiresAt: new Date(now.getTime() + 1_000),
        usedAt: now,
        now,
      }),
    ).toBe(false);
  });
});

describe('acceptsSubscriptions', () => {
  it('takes subscribers while open', () => {
    expect(acceptsSubscriptions('OPEN')).toBe(true);
  });

  it.each(['DRAFT', 'ACTIVE', 'COMPLETED', 'SUSPENDED', 'CANCELLED'])(
    'refuses a %s programme',
    (status) => {
      // ACTIVE included deliberately: procurement has begun, so a late joiner
      // would not be counted in what was bought.
      expect(acceptsSubscriptions(status)).toBe(false);
    },
  );
});

describe('assertCanSubscribe', () => {
  const valid = {
    status: 'OPEN',
    capacity: 10,
    enrolled: 4,
    quantity: 1,
    packageBelongsToProgramme: true,
    packageIsActive: true,
    alreadySubscribed: false,
  };

  it('accepts a valid request', () => {
    expect(() => assertCanSubscribe(valid)).not.toThrow();
  });

  it('refuses a programme that is not open', () => {
    expect(() => assertCanSubscribe({ ...valid, status: 'DRAFT' })).toThrow(/not open/i);
  });

  it('refuses a package from another programme', () => {
    // Otherwise a member could enrol in a package whose price and contents
    // belong to a programme they are not part of.
    expect(() => assertCanSubscribe({ ...valid, packageBelongsToProgramme: false })).toThrow(
      /not part of this programme/i,
    );
  });

  it('refuses a withdrawn package', () => {
    expect(() => assertCanSubscribe({ ...valid, packageIsActive: false })).toThrow(
      /no longer available/i,
    );
  });

  it('refuses enrolling twice in the same package', () => {
    expect(() => assertCanSubscribe({ ...valid, alreadySubscribed: true })).toThrow(
      /already enrolled/i,
    );
  });

  it.each([0, -1, 1.5])('refuses a quantity of %p', (quantity) => {
    expect(() => assertCanSubscribe({ ...valid, quantity })).toThrow(/at least one/i);
  });

  it('allows filling the last place exactly', () => {
    expect(() => assertCanSubscribe({ ...valid, enrolled: 9, quantity: 1 })).not.toThrow();
  });

  it('refuses one place beyond capacity', () => {
    expect(() => assertCanSubscribe({ ...valid, enrolled: 10, quantity: 1 })).toThrow(/full/i);
  });

  it('counts quantity against capacity, not headcount', () => {
    // Three portions consume three places; otherwise a programme could be
    // oversubscribed by one member asking for more.
    expect(() => assertCanSubscribe({ ...valid, enrolled: 8, quantity: 3 })).toThrow(/full/i);
  });
});

describe('remainingCapacity', () => {
  it('reports the places left', () => {
    expect(remainingCapacity(10, 4)).toBe(6);
  });

  it('never goes negative when capacity was reduced after enrolment', () => {
    expect(remainingCapacity(3, 5)).toBe(0);
  });
});

describe('canCancelSubscription', () => {
  it.each(['PENDING', 'ACTIVE'])('allows withdrawing a %s subscription', (status) => {
    expect(canCancelSubscription(status)).toBe(true);
  });

  it.each(['COMPLETED', 'CANCELLED', 'DEFAULTED'])(
    'refuses a %s subscription, which is already settled',
    (status) => {
      expect(canCancelSubscription(status)).toBe(false);
    },
  );
});
