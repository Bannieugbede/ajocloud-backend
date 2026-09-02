import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  assertDifferentWallets,
  assertPayableAmount,
  assertSameCurrency,
  assertSufficientFunds,
  assertWalletActive,
} from './wallet-policy.js';

describe('assertPayableAmount', () => {
  it('accepts a positive amount', () => {
    expect(() => assertPayableAmount(1n)).not.toThrow();
  });

  it.each([0n, -1n])('refuses %s', (amount) => {
    expect(() => assertPayableAmount(amount)).toThrow(UnprocessableEntityException);
  });
});

describe('assertSufficientFunds', () => {
  it('allows a balance that exactly covers the movement', () => {
    expect(() => assertSufficientFunds(5_000n, 5_000n)).not.toThrow();
  });

  it('refuses one minor unit short', () => {
    expect(() => assertSufficientFunds(4_999n, 5_000n)).toThrow(/not enough/i);
  });

  it('stays exact far above the safe integer range', () => {
    // Money is BigInt end to end; a Number here would round and let an
    // overdraft through at large balances.
    const huge = 10n ** 20n;
    expect(() => assertSufficientFunds(huge, huge + 1n)).toThrow();
    expect(() => assertSufficientFunds(huge + 1n, huge)).not.toThrow();
  });
});

describe('assertDifferentWallets', () => {
  it('allows two different wallets', () => {
    expect(() => assertDifferentWallets('a', 'b')).not.toThrow();
  });

  it('refuses sending to the same wallet, which would post a debit and credit to one account', () => {
    expect(() => assertDifferentWallets('a', 'a')).toThrow(/different wallet/i);
  });
});

describe('assertWalletActive', () => {
  it('allows an active wallet', () => {
    expect(() => assertWalletActive('ACTIVE', 'source')).not.toThrow();
  });

  it.each(['FROZEN', 'CLOSED', 'SUSPENDED'])('refuses a %s wallet', (status) => {
    expect(() => assertWalletActive(status, 'source')).toThrow(ConflictException);
  });

  it('names which side failed, so the message is actionable', () => {
    expect(() => assertWalletActive('FROZEN', 'destination')).toThrow(/destination/);
  });
});

describe('assertSameCurrency', () => {
  it('allows matching currencies', () => {
    expect(() => assertSameCurrency('NGN', 'NGN')).not.toThrow();
  });

  it('refuses a cross-currency movement, which has no agreed rate', () => {
    expect(() => assertSameCurrency('NGN', 'USD')).toThrow(/same currency/i);
  });
});
