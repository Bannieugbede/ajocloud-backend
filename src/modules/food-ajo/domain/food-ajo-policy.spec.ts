import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  acceptsSubscriptions,
  assertCanCompleteProgramme,
  assertCanConfirmCollection,
  assertCanOpenProgramme,
  assertCanPlanDistribution,
  assertCanProcure,
  assertPackageEditable,
  assertVendorUsable,
  canTransitionDistribution,
  canTransitionProgramme,
  canTransitionPurchaseOrder,
  generateCollectionCode,
  isValidCollectionCodeShape,
  normalizeCollectionCode,
  purchaseOrderTotalMinor,
  scaleByQuantity,
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

describe('programme lifecycle', () => {
  it('opens and cancels a draft, but cannot complete it', () => {
    expect(canTransitionProgramme('DRAFT', 'OPEN')).toBe(true);
    expect(canTransitionProgramme('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransitionProgramme('DRAFT', 'COMPLETED')).toBe(false);
    expect(canTransitionProgramme('DRAFT', 'ACTIVE')).toBe(false);
  });

  it('refuses to reopen a terminal programme', () => {
    for (const to of ['DRAFT', 'OPEN', 'ACTIVE']) {
      expect(canTransitionProgramme('COMPLETED', to)).toBe(false);
      expect(canTransitionProgramme('CANCELLED', to)).toBe(false);
    }
  });

  it('lets a suspended programme resume but not skip to completed', () => {
    expect(canTransitionProgramme('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionProgramme('SUSPENDED', 'COMPLETED')).toBe(false);
  });

  it('needs an active package before it can open', () => {
    expect(() =>
      assertCanOpenProgramme({ status: 'DRAFT', packages: [], enrolmentCapacity: 50 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertCanOpenProgramme({
        status: 'DRAFT',
        packages: [{ priceMinor: 50_000n, isActive: false }],
        enrolmentCapacity: 50,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('opens a draft holding a priced package', () => {
    expect(() =>
      assertCanOpenProgramme({
        status: 'DRAFT',
        packages: [{ priceMinor: 50_000n, isActive: true }],
        enrolmentCapacity: 50,
      }),
    ).not.toThrow();
  });

  it('refuses to open a programme that is already open', () => {
    expect(() =>
      assertCanOpenProgramme({
        status: 'OPEN',
        packages: [{ priceMinor: 50_000n, isActive: true }],
        enrolmentCapacity: 50,
      }),
    ).toThrow(ConflictException);
  });
});

describe('package price lock', () => {
  it('refuses to edit a package whose price is locked', () => {
    expect(() =>
      assertPackageEditable({ programmeStatus: 'DRAFT', priceLockedAt: new Date() }),
    ).toThrow(ConflictException);
  });

  it('refuses to edit a package once the programme has left draft', () => {
    expect(() => assertPackageEditable({ programmeStatus: 'OPEN', priceLockedAt: null })).toThrow(
      ConflictException,
    );
  });

  it('allows editing an unlocked package in a draft', () => {
    expect(() =>
      assertPackageEditable({ programmeStatus: 'DRAFT', priceLockedAt: null }),
    ).not.toThrow();
  });
});

describe('procurement', () => {
  it('refuses to procure before enrolment has closed', () => {
    expect(() => assertCanProcure({ status: 'OPEN', subscribedPortions: 20 })).toThrow(
      ConflictException,
    );
  });

  it('refuses to procure for nobody', () => {
    expect(() => assertCanProcure({ status: 'ACTIVE', subscribedPortions: 0 })).toThrow(
      UnprocessableEntityException,
    );
  });

  it('procures for an active programme with enrolments', () => {
    expect(() => assertCanProcure({ status: 'ACTIVE', subscribedPortions: 20 })).not.toThrow();
  });

  it('refuses an unverified vendor', () => {
    expect(() => assertVendorUsable({ exists: true, isVerified: false })).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertVendorUsable({ exists: false, isVerified: true })).toThrow(
      NotFoundException,
    );
  });

  it('will not cancel an order the vendor has confirmed', () => {
    expect(canTransitionPurchaseOrder('CONFIRMED', 'CANCELLED')).toBe(false);
    expect(canTransitionPurchaseOrder('CONFIRMED', 'FULFILLED')).toBe(true);
  });

  it('will not fulfil an order that was never confirmed', () => {
    expect(canTransitionPurchaseOrder('DRAFT', 'FULFILLED')).toBe(false);
    expect(canTransitionPurchaseOrder('SUBMITTED', 'FULFILLED')).toBe(false);
  });
});

describe('purchaseOrderTotalMinor', () => {
  it('totals whole quantities exactly', () => {
    expect(
      purchaseOrderTotalMinor([
        { quantity: '10', unitPriceMinor: 250_00n },
        { quantity: '3', unitPriceMinor: 1_000_00n },
      ]),
    ).toBe(550_000n);
  });

  it('multiplies a fractional quantity without float drift', () => {
    // 2.5 x 33.33 is 83.325, which as a float lands on 83.32499999999999.
    expect(purchaseOrderTotalMinor([{ quantity: '2.5', unitPriceMinor: 33_33n }])).toBe(8_333n);
  });

  it('rounds half up so the vendor is not systematically underpaid', () => {
    expect(scaleByQuantity(1n, '0.5')).toBe(1n);
    expect(scaleByQuantity(1n, '0.499')).toBe(0n);
  });

  it('is zero for an order with no lines', () => {
    expect(purchaseOrderTotalMinor([])).toBe(0n);
  });
});

describe('distribution', () => {
  const now = new Date('2026-09-02T10:00:00.000Z');
  const later = new Date('2026-09-03T10:00:00.000Z');

  it('refuses to plan a distribution with nothing procured', () => {
    expect(() =>
      assertCanPlanDistribution({
        programmeStatus: 'ACTIVE',
        fulfilledOrders: 0,
        scheduledAt: later,
        now,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('refuses a distribution scheduled in the past', () => {
    expect(() =>
      assertCanPlanDistribution({
        programmeStatus: 'ACTIVE',
        fulfilledOrders: 1,
        scheduledAt: new Date('2026-09-01T10:00:00.000Z'),
        now,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('plans a distribution once an order is fulfilled', () => {
    expect(() =>
      assertCanPlanDistribution({
        programmeStatus: 'ACTIVE',
        fulfilledOrders: 1,
        scheduledAt: later,
        now,
      }),
    ).not.toThrow();
  });

  it('cannot start handing out before the goods are marked ready', () => {
    expect(canTransitionDistribution('PLANNED', 'DISTRIBUTING')).toBe(false);
    expect(canTransitionDistribution('PLANNED', 'READY')).toBe(true);
    expect(canTransitionDistribution('READY', 'DISTRIBUTING')).toBe(true);
  });

  it('cannot cancel a distribution that has begun', () => {
    expect(canTransitionDistribution('DISTRIBUTING', 'CANCELLED')).toBe(false);
  });

  it('only confirms collection while goods are being handed out', () => {
    expect(() =>
      assertCanConfirmCollection({ distributionStatus: 'READY', alreadyConfirmed: false }),
    ).toThrow(ConflictException);
    expect(() =>
      assertCanConfirmCollection({ distributionStatus: 'DISTRIBUTING', alreadyConfirmed: false }),
    ).not.toThrow();
  });

  it('refuses a second confirmation for the same item', () => {
    expect(() =>
      assertCanConfirmCollection({ distributionStatus: 'DISTRIBUTING', alreadyConfirmed: true }),
    ).toThrow(ConflictException);
  });

  it('will not complete a programme while members are still owed food', () => {
    expect(() =>
      assertCanCompleteProgramme({ status: 'ACTIVE', outstandingCollections: 3 }),
    ).toThrow(ConflictException);
    expect(() =>
      assertCanCompleteProgramme({ status: 'ACTIVE', outstandingCollections: 0 }),
    ).not.toThrow();
  });
});

describe('collection codes', () => {
  it('generates a code free of ambiguous characters', () => {
    const code = generateCollectionCode(Uint8Array.from([0, 1, 2, 3, 4, 5]));
    expect(code).toHaveLength(6);
    expect(code).not.toMatch(/[ILO01]/);
    expect(isValidCollectionCodeShape(code)).toBe(true);
  });

  it('accepts a code typed with spacing or lowercase', () => {
    const code = generateCollectionCode(Uint8Array.from([9, 12, 3, 30, 7, 21]));
    expect(normalizeCollectionCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(isValidCollectionCodeShape(` ${code.toLowerCase()} `)).toBe(true);
  });

  it('rejects a code of the wrong shape', () => {
    expect(isValidCollectionCodeShape('ABC')).toBe(false);
    expect(isValidCollectionCodeShape('ABCDE1')).toBe(false);
  });
});
