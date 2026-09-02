import {
  INTENT_TTL_MS,
  canPayFromWallet,
  isConfirmable,
  isPayable,
  isPayableAmount,
  isTerminal,
  settlesSynchronously,
  totalFor,
} from './payment-policy.js';

describe('isConfirmable', () => {
  it('allows only an intent awaiting confirmation', () => {
    expect(isConfirmable('REQUIRES_CONFIRMATION')).toBe(true);
  });

  it.each(['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const)(
    'refuses a %s intent, so a settled payment cannot be paid again',
    (status) => {
      expect(isConfirmable(status)).toBe(false);
    },
  );
});

describe('isPayable', () => {
  const now = new Date('2026-09-02T10:00:00.000Z');

  it('accepts a confirmable intent that has not expired', () => {
    expect(isPayable('REQUIRES_CONFIRMATION', new Date(now.getTime() + 1000), now)).toBe(true);
  });

  it('refuses an expired intent, whose amount may no longer match the target', () => {
    expect(isPayable('REQUIRES_CONFIRMATION', new Date(now.getTime() - 1), now)).toBe(false);
  });

  it('treats the expiry instant itself as expired', () => {
    // The boundary is stated explicitly because "expires at 10:00" must not
    // leave a payment settleable at exactly 10:00.
    expect(isPayable('REQUIRES_CONFIRMATION', now, now)).toBe(false);
  });

  it('refuses an unexpired intent that is no longer confirmable', () => {
    expect(isPayable('SUCCEEDED', new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});

describe('isTerminal', () => {
  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)('treats %s as final', (status) => {
    expect(isTerminal(status)).toBe(true);
  });

  it.each(['REQUIRES_CONFIRMATION', 'PROCESSING'] as const)(
    'treats %s as still changing, so the client keeps polling',
    (status) => {
      expect(isTerminal(status)).toBe(false);
    },
  );
});

describe('settlesSynchronously', () => {
  it('settles a wallet payment inside the request', () => {
    expect(settlesSynchronously('WALLET')).toBe(true);
  });

  it.each(['TRANSFER', 'CARD'] as const)(
    'never settles %s inline: only a verified webhook may complete it (ADR-006)',
    (method) => {
      expect(settlesSynchronously(method)).toBe(false);
    },
  );
});

describe('totalFor', () => {
  it('adds the fee to the amount', () => {
    expect(totalFor(5_000n, 50n)).toBe(5_050n);
  });

  it('stays exact far beyond the safe integer range', () => {
    // Money is BigInt end to end; a Number here would round and lose kobo.
    const huge = 10n ** 20n;
    expect(totalFor(huge, 1n)).toBe(huge + 1n);
  });
});

describe('isPayableAmount', () => {
  it('accepts a positive amount', () => {
    expect(isPayableAmount(1n)).toBe(true);
  });

  it.each([0n, -1n])('refuses %s, which would post a meaningless entry', (amount) => {
    expect(isPayableAmount(amount)).toBe(false);
  });
});

describe('canPayFromWallet', () => {
  it('allows a balance that exactly covers the total', () => {
    expect(canPayFromWallet(5_050n, 5_050n)).toBe(true);
  });

  it('refuses a balance one minor unit short', () => {
    expect(canPayFromWallet(5_049n, 5_050n)).toBe(false);
  });
});

describe('INTENT_TTL_MS', () => {
  it('is long enough to enter a PIN but short enough that the amount stays current', () => {
    expect(INTENT_TTL_MS).toBe(15 * 60 * 1000);
  });
});
