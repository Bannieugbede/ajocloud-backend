import {
  acceptsMembers,
  acceptsPayment,
  canCancel,
  canRemoveMember,
  canTransition,
  collectionProgressBps,
  generateJoinCode,
  isValidJoinCodeShape,
  normalizeJoinCode,
} from './pool-policy.js';

describe('pool lifecycle', () => {
  it('accepts members and payment only while open', () => {
    expect(acceptsMembers('OPEN')).toBe(true);
    for (const status of ['DRAFT', 'CLOSED', 'CANCELLED'] as const) {
      expect(acceptsMembers(status)).toBe(false);
      expect(acceptsPayment(status, 'PENDING')).toBe(false);
    }
  });

  it('refuses payment for a due that is not outstanding', () => {
    expect(acceptsPayment('OPEN', 'PENDING')).toBe(true);
    for (const due of ['PAID', 'PROCESSING', 'WAIVED'] as const) {
      expect(acceptsPayment('OPEN', due)).toBe(false);
    }
  });

  it('allows only forward transitions and treats decided states as terminal', () => {
    expect(canTransition('DRAFT', 'OPEN')).toBe(true);
    expect(canTransition('OPEN', 'CLOSED')).toBe(true);
    expect(canTransition('CLOSED', 'OPEN')).toBe(false);
    expect(canTransition('CANCELLED', 'OPEN')).toBe(false);
    expect(canTransition('CLOSED', 'CANCELLED')).toBe(false);
  });

  it('refuses to cancel a pool that has taken money', () => {
    // There is no refund workflow, so cancelling would strand what was paid.
    expect(canCancel('OPEN', 0)).toBe(true);
    expect(canCancel('OPEN', 1)).toBe(false);
  });

  it('refuses to remove a member who has paid', () => {
    expect(canRemoveMember('PENDING')).toBe(true);
    expect(canRemoveMember('WAIVED')).toBe(true);
    expect(canRemoveMember('PAID')).toBe(false);
    expect(canRemoveMember('PROCESSING')).toBe(false);
  });
});

describe('collectionProgressBps', () => {
  it('reports progress in basis points without early rounding', () => {
    expect(collectionProgressBps(0n, 100_000n)).toBe(0);
    expect(collectionProgressBps(25_000n, 100_000n)).toBe(2_500);
    expect(collectionProgressBps(100_000n, 100_000n)).toBe(10_000);
  });

  it('stays exact for sums beyond Number.MAX_SAFE_INTEGER', () => {
    expect(collectionProgressBps(9_007_199_254_740_993n, 18_014_398_509_481_986n)).toBe(5_000);
  });

  it('clamps overpayment and tolerates an empty pool', () => {
    expect(collectionProgressBps(150_000n, 100_000n)).toBe(10_000);
    expect(collectionProgressBps(1n, 0n)).toBe(0);
  });
});

describe('join codes', () => {
  it('generates a code from the unambiguous alphabet', () => {
    const code = generateJoinCode(Uint8Array.from(Array.from({ length: 8 }, (_, i) => i * 7)));
    expect(code).toHaveLength(8);
    expect(isValidJoinCodeShape(code)).toBe(true);
    // These are read aloud and typed by hand, so the confusable pairs are out.
    expect(code).not.toMatch(/[OIL01]/);
  });

  it('normalizes the spacing and case people actually type', () => {
    expect(normalizeJoinCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(isValidJoinCodeShape('abcd-2345')).toBe(true);
  });

  it('rejects a code of the wrong shape', () => {
    expect(isValidJoinCodeShape('ABC')).toBe(false);
    expect(isValidJoinCodeShape('ABCD23451')).toBe(false);
    expect(isValidJoinCodeShape('ABCD234O')).toBe(false);
  });
});
