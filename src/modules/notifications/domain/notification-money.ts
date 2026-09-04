/** Symbols for the currencies the product actually quotes. */
const SYMBOLS: Readonly<Record<string, string>> = { NGN: '₦' };

/**
 * Money as it should read inside a notification.
 *
 * Notification copy is the first place the backend shows an amount to a
 * person rather than to another system, so the formatting lives here rather
 * than being improvised at each call site — a payout that says "150000" would
 * be alarming, and one that says "₦1,500" when it means "₦1,500.50" is worse.
 *
 * Kept as integer arithmetic on the minor units. Going through a float to
 * divide by 100 would lose precision on amounts a group can genuinely reach.
 */
export function formatMoney(amountMinor: bigint, currency: string): string {
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;

  const major = groupThousands((absolute / 100n).toString());
  const minor = (absolute % 100n).toString().padStart(2, '0');
  const symbol = SYMBOLS[currency] ?? `${currency} `;

  return `${negative ? '-' : ''}${symbol}${major}.${minor}`;
}

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A date as a person reading a notification would say it.
 *
 * Rendered in the group's own timezone rather than the server's: a
 * contribution due on the 1st in Lagos must not be announced as due on the
 * 31st because the server happens to run in UTC.
 */
export function formatDueDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date);
}
