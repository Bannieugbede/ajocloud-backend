import { formatDueDate, formatMoney } from './notification-money.js';

describe('formatMoney', () => {
  it('renders naira with a symbol, thousands separators and kobo', () => {
    expect(formatMoney(1_500_000n, 'NGN')).toBe('₦15,000.00');
  });

  it('keeps kobo that are not whole naira', () => {
    // A payout of ₦1,500.50 announced as "₦1,500" is wrong by fifty kobo, and
    // the recipient can see the real figure in their balance.
    expect(formatMoney(150_050n, 'NGN')).toBe('₦1,500.50');
  });

  it('groups every thousand, not just the first', () => {
    expect(formatMoney(123_456_789n, 'NGN')).toBe('₦1,234,567.89');
  });

  it('does not add a separator below a thousand', () => {
    expect(formatMoney(50_000n, 'NGN')).toBe('₦500.00');
  });

  it('renders zero rather than an empty string', () => {
    expect(formatMoney(0n, 'NGN')).toBe('₦0.00');
  });

  it('renders sub-naira amounts with a leading zero', () => {
    expect(formatMoney(5n, 'NGN')).toBe('₦0.05');
  });

  it('puts the sign before the symbol on a negative amount', () => {
    expect(formatMoney(-150_000n, 'NGN')).toBe('-₦1,500.00');
  });

  it('falls back to the currency code when no symbol is known', () => {
    expect(formatMoney(150_000n, 'USD')).toBe('USD 1,500.00');
  });

  it('stays exact at amounts a float would round', () => {
    // 2^53 kobo is inside the range a group pool can reach over a long
    // rotation, and going through a Number to divide by 100 loses it.
    expect(formatMoney(9_007_199_254_740_993n, 'NGN')).toBe('₦90,071,992,547,409.93');
  });
});

describe('formatDueDate', () => {
  it('renders the date in the group’s own timezone', () => {
    // 23:30 UTC on the 30th is already the 1st in Lagos. Announcing "30 June"
    // to a group whose contribution is due on 1 July would be wrong.
    const instant = new Date('2026-06-30T23:30:00.000Z');
    expect(formatDueDate(instant, 'Africa/Lagos')).toBe('1 July');
  });

  it('renders the same instant differently for a different zone', () => {
    const instant = new Date('2026-06-30T23:30:00.000Z');
    expect(formatDueDate(instant, 'UTC')).toBe('30 June');
  });
});
