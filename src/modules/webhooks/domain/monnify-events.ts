/**
 * Monnify webhook event taxonomy and safe payload extraction.
 *
 * Everything here treats the payload as hostile input: it is parsed from an
 * unauthenticated public endpoint, and although the signature proves the sender
 * holds the merchant secret, the shape is still whatever arrived on the wire.
 * No field is assumed present or well-typed.
 */

/** One route, and one dashboard callback URL, per member. */
export const MONNIFY_EVENT_KINDS = [
  'TRANSACTION_COMPLETION',
  'REFUND_COMPLETION',
  'DISBURSEMENT',
  'SETTLEMENT',
  'WALLET_ACTIVITY',
  'LOW_BALANCE',
  'BILLS_PAYMENT',
] as const;

export type MonnifyEventKind = (typeof MONNIFY_EVENT_KINDS)[number];

/** Route segment for each kind, matching the URLs registered with Monnify. */
export const MONNIFY_EVENT_PATHS: Record<MonnifyEventKind, string> = {
  TRANSACTION_COMPLETION: 'transaction-completion',
  REFUND_COMPLETION: 'refund-completion',
  DISBURSEMENT: 'disbursement',
  SETTLEMENT: 'settlement',
  WALLET_ACTIVITY: 'wallet-activity',
  LOW_BALANCE: 'low-balance',
  BILLS_PAYMENT: 'bills-payment',
};

/**
 * `eventType` values Monnify sends, mapped to our kinds.
 *
 * Used to detect a mismatch between the route an event arrived on and what it
 * claims to be — a sign of misconfiguration in the dashboard, which is worth
 * recording rather than silently processing under the wrong handler.
 */
const EVENT_TYPE_ALIASES: Record<string, MonnifyEventKind> = {
  SUCCESSFUL_TRANSACTION: 'TRANSACTION_COMPLETION',
  SUCCESSFUL_DISBURSEMENT: 'DISBURSEMENT',
  FAILED_DISBURSEMENT: 'DISBURSEMENT',
  REVERSED_DISBURSEMENT: 'DISBURSEMENT',
  SUCCESSFUL_REFUND: 'REFUND_COMPLETION',
  REFUND_COMPLETION: 'REFUND_COMPLETION',
  SETTLEMENT: 'SETTLEMENT',
  SETTLEMENT_COMPLETION: 'SETTLEMENT',
  WALLET_ACTIVITY: 'WALLET_ACTIVITY',
  LOW_BALANCE_ALERT: 'LOW_BALANCE',
  BILLS_PAYMENT: 'BILLS_PAYMENT',
};

export interface MonnifyEventEnvelope {
  readonly eventType?: unknown;
  readonly eventData?: unknown;
  readonly [key: string]: unknown;
}

/** What we retain from an event, after validation. */
export interface ExtractedMonnifyEvent {
  /** Stable per-event identity; the deduplication key. */
  readonly eventId: string;
  readonly declaredType: string | null;
  /** Set when `eventType` maps to a different kind than the route implies. */
  readonly routeMismatch: boolean;
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly providerReference: string | null;
  readonly internalReference: string | null;
  readonly timestamp: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Converts a major-unit provider amount to integer minor units.
 *
 * Monnify sends amounts as decimal numbers ("5000.55"). Money is held in
 * integer minor units throughout this codebase, and floating-point arithmetic
 * on money is never acceptable, so the conversion is done on the decimal string
 * rather than by multiplying a float.
 */
export function toMinorUnits(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  // Pad or truncate to exactly two decimal places.
  const minorFraction = `${fraction}00`.slice(0, 2);
  // Reject sub-minor precision rather than rounding money silently.
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) return null;

  const magnitude = BigInt(`${whole}${minorFraction}`);
  return negative ? -magnitude : magnitude;
}

/**
 * Pulls the fields we act on out of an arbitrary payload.
 *
 * @param rawBodyHash Fallback event identity. Monnify does not guarantee an
 * explicit event id on every event type, and deduplication must never silently
 * degrade to "no deduplication": hashing the body means an identical redelivery
 * still collides on the unique constraint.
 */
export function extractMonnifyEvent(
  payload: MonnifyEventEnvelope,
  routeKind: MonnifyEventKind,
  rawBodyHash: string,
): ExtractedMonnifyEvent {
  const data = asRecord(payload.eventData);
  const declaredType = typeof payload.eventType === 'string' ? payload.eventType : null;
  const mappedKind = declaredType ? EVENT_TYPE_ALIASES[declaredType] : undefined;

  const providerReference = readString(
    data,
    'transactionReference',
    'reference',
    'settlementReference',
    'refundReference',
    'transactionHash',
  );
  const internalReference = readString(
    data,
    'paymentReference',
    'merchantReference',
    'customerReference',
  );

  // Prefer a provider-issued identifier; fall back to the body hash so
  // deduplication always has a key.
  const eventId = providerReference
    ? `${routeKind}:${providerReference}`
    : `${routeKind}:sha256:${rawBodyHash}`;

  return {
    eventId,
    declaredType,
    routeMismatch: mappedKind !== undefined && mappedKind !== routeKind,
    amountMinor: toMinorUnits(data.amountPaid ?? data.amount ?? data.settlementAmount),
    currency: readString(data, 'currency', 'currencyCode'),
    providerReference,
    internalReference,
    timestamp: readString(data, 'paidOn', 'createdOn', 'eventTime', 'completedOn'),
  };
}
