import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { KycReviewService } from './kyc-review.service.js';

/**
 * Shapes of the Prisma writes under test. They are declared rather than inferred
 * so a decision's recorded fields are asserted against a real type instead of
 * `any`, which would let a renamed field pass silently.
 */
type ProfileUpdateData = {
  status: string;
  tier?: string;
  level?: number;
  verifiedAt?: Date;
  restrictedAt?: Date;
};
type ProfileUpdateArgs = { where: unknown; data: ProfileUpdateData; select?: unknown };
type ReviewWriteData = {
  kycProfileId?: string;
  reviewerId: string;
  status: string;
  reason: string;
  decidedAt: Date;
};
type ReviewWriteArgs = { where?: unknown; data: ReviewWriteData };
type AuditWriteArgs = { data: Record<string, unknown> };
type WriteResult = Record<string, unknown>;

/**
 * Returns the first call's arguments, failing the test if the mock was never
 * called. Without this, strict index access makes every assertion carry a
 * non-null assertion that would hide a genuinely missing write.
 */
function firstCall<A extends unknown[]>(mock: jest.Mock<WriteResult, A>): A {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected the write to have been called, but it was not');
  return call;
}

type ProfileSeed = {
  id?: string;
  userId?: string;
  status?: string;
  tier?: string;
  passedChecks?: string[];
  openReviewId?: string | null;
};

/**
 * The transaction client is hand-built rather than mocked wholesale so each test
 * can assert exactly which rows a decision wrote — the audit entry and outbox
 * event are the compliance record, so their absence is a real defect.
 */
function build(seed: ProfileSeed = {}) {
  const profile =
    seed.status === 'MISSING'
      ? null
      : {
          id: seed.id ?? 'kyc-1',
          userId: seed.userId ?? 'user-1',
          status: seed.status ?? 'PENDING',
          tier: seed.tier ?? 'TIER_1',
          checks: (seed.passedChecks ?? ['BVN']).map((type) => ({ type })),
        };

  const calls = {
    profileUpdate: jest.fn<WriteResult, [ProfileUpdateArgs]>(({ data }) => ({
      id: 'kyc-1',
      ...data,
    })),
    reviewUpdate: jest.fn<WriteResult, [ReviewWriteArgs]>(() => ({})),
    reviewCreate: jest.fn<WriteResult, [ReviewWriteArgs]>(() => ({})),
    auditCreate: jest.fn<WriteResult, [AuditWriteArgs]>(() => ({})),
    outboxCreate: jest.fn<WriteResult, [AuditWriteArgs]>(() => ({})),
  };

  const tx = {
    kycProfile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      update: calls.profileUpdate,
    },
    complianceReview: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          seed.openReviewId === null ? null : { id: seed.openReviewId ?? 'review-1' },
        ),
      update: calls.reviewUpdate,
      create: calls.reviewCreate,
    },
    auditLog: { create: calls.auditCreate },
    outboxEvent: { create: calls.outboxCreate },
  };

  const transactions = {
    serializable: <T>(operation: (client: unknown) => Promise<T>): Promise<T> => operation(tx),
  };

  const notifications = { notify: jest.fn().mockResolvedValue({ inApp: true, pushed: 1 }) };
  const service = new KycReviewService({} as never, transactions as never, notifications as never);
  return { service, calls, transactions, notifications };
}

describe('KycReviewService.approve', () => {
  it('verifies the profile, closes the open review, and records the decision', async () => {
    const { service, calls } = build({ passedChecks: ['BVN'] });

    const result = await service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never);

    expect(result).toMatchObject({ status: 'VERIFIED', tier: 'TIER_2', level: 2 });
    const [reviewArgs] = firstCall(calls.reviewUpdate);
    expect(reviewArgs.where).toEqual({ id: 'review-1' });
    expect(reviewArgs.data).toMatchObject({ reviewerId: 'reviewer-1', status: 'APPROVED' });
    expect(calls.reviewCreate).not.toHaveBeenCalled();

    const [auditArgs] = firstCall(calls.auditCreate);
    expect(auditArgs.data).toMatchObject({
      action: 'kyc.profile.approve',
      actorUserId: 'reviewer-1',
      subjectType: 'KycProfile',
    });
    expect(calls.outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses a tier the profile has no evidence for', async () => {
    const { service, calls } = build({ passedChecks: ['BVN'] });

    await expect(
      service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_3' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // Nothing may be written when the decision is refused.
    expect(calls.profileUpdate).not.toHaveBeenCalled();
    expect(calls.auditCreate).not.toHaveBeenCalled();
    expect(calls.outboxCreate).not.toHaveBeenCalled();
  });

  it('grants Tier 3 when both identity and bank evidence passed', async () => {
    const { service } = build({ passedChecks: ['NIN', 'BANK_ACCOUNT'] });

    const result = await service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_3' } as never);

    expect(result).toMatchObject({ tier: 'TIER_3', level: 3, status: 'VERIFIED' });
  });

  it('opens a review row when the profile had no open item', async () => {
    const { service, calls } = build({ openReviewId: null });

    await service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never);

    const [createArgs] = firstCall(calls.reviewCreate);
    expect(createArgs.data).toMatchObject({ kycProfileId: 'kyc-1', status: 'APPROVED' });
    expect(calls.reviewUpdate).not.toHaveBeenCalled();
  });
});

describe('KycReviewService decisions other than approval', () => {
  it('rejects the profile and restricts it', async () => {
    const { service, calls } = build();

    const result = await service.reject('reviewer-1', 'kyc-1', {
      reason: 'Document did not match',
    } as never);

    expect(result).toMatchObject({ status: 'REJECTED' });
    expect(firstCall(calls.profileUpdate)[0].data.restrictedAt).toBeInstanceOf(Date);
    const [rejectArgs] = firstCall(calls.reviewUpdate);
    expect(rejectArgs.data).toMatchObject({
      status: 'REJECTED',
      reason: 'Document did not match',
    });
  });

  it('distinguishes an escalation from an information request on the review row', async () => {
    const escalated = build();
    await escalated.service.escalate('reviewer-1', 'kyc-1', { reason: 'Possible match' } as never);
    expect(firstCall(escalated.calls.reviewUpdate)[0].data.status).toBe('ESCALATED');

    const asked = build();
    await asked.service.requestInformation('reviewer-1', 'kyc-1', {
      reason: 'Send a clearer photo',
    } as never);
    expect(firstCall(asked.calls.reviewUpdate)[0].data.status).toBe('CLOSED');

    // Both leave the applicant in the same profile state, which is why the
    // review row has to carry the distinction.
    expect(firstCall(escalated.calls.profileUpdate)[0].data.status).toBe('REQUIRES_REVIEW');
    expect(firstCall(asked.calls.profileUpdate)[0].data.status).toBe('REQUIRES_REVIEW');
  });

  it('never marks a non-approval as verified', async () => {
    const { service, calls } = build();
    await service.reject('reviewer-1', 'kyc-1', { reason: 'Failed checks' } as never);
    expect(firstCall(calls.profileUpdate)[0].data.verifiedAt).toBeUndefined();
  });
});

describe('KycReviewService notifications', () => {
  it('tells the applicant when they are approved', async () => {
    const { service, notifications } = build();
    await service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never);

    const sent = firstArg<{
      userId: string;
      template: string;
      storedPayload: Record<string, string>;
    }>(notifications.notify);
    expect(sent.template).toBe('kyc-approved');
    expect(sent.userId).toBe('user-1');
  });

  it('tells the applicant when they are rejected', async () => {
    const { service, notifications } = build();
    await service.reject('reviewer-1', 'kyc-1', { reason: 'Blurred document' } as never);

    expect(firstArg<{ template: string }>(notifications.notify).template).toBe('kyc-rejected');
  });

  it('never carries the reviewer’s reason into the notification', async () => {
    // The reason is written for an internal audit trail. A push payload crosses
    // Apple's and Google's infrastructure and shows on a lock screen.
    const { service, notifications } = build();
    await service.reject('reviewer-1', 'kyc-1', { reason: 'Suspected forgery' } as never);

    expect(JSON.stringify(firstArg(notifications.notify))).not.toContain('Suspected forgery');
  });

  it.each([['escalate'], ['requestInformation']] as const)(
    'does not notify on %s, which settles nothing',
    async (method) => {
      // These move a profile without concluding it. "Verification needs
      // attention" for an internal escalation would be alarming and untrue.
      const { service, notifications } = build();
      await service[method]('reviewer-1', 'kyc-1', { reason: 'Needs a look' } as never);
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );

  it('does not notify when the decision was refused', async () => {
    const { service, notifications } = build({ status: 'VERIFIED' });
    await expect(
      service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never),
    ).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('still records the decision when notifying rejects', async () => {
    const { service, notifications } = build();
    notifications.notify.mockRejectedValue(new Error('unreachable'));

    await expect(
      service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });
});

describe('KycReviewService guards', () => {
  it('refuses to re-decide a settled profile', async () => {
    for (const status of ['VERIFIED', 'REJECTED', 'NOT_STARTED']) {
      const { service, calls } = build({ status });
      await expect(
        service.approve('reviewer-1', 'kyc-1', { tier: 'TIER_2' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(calls.profileUpdate).not.toHaveBeenCalled();
    }
  });

  it('reports a missing profile rather than creating one', async () => {
    const { service } = build({ status: 'MISSING' });
    await expect(
      service.reject('reviewer-1', 'kyc-1', { reason: 'n/a' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
