import { ForbiddenException } from '@nestjs/common';
import {
  assertCoordinatorCanCreateProgramme,
  assertPackageActivation,
  canConsumeDistributionToken,
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
