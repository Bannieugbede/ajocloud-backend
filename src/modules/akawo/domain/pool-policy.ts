import type { AkawoDueStatus, AkawoPoolStatus } from '../../../../generated/prisma/enums.js';

/**
 * Rules for Akawo collection pools (ADR-007). Kept free of Prisma and Nest so
 * the money-adjacent decisions can be tested without a database.
 */

/** A pool only accepts new members while it is open. */
export function acceptsMembers(status: AkawoPoolStatus): boolean {
  return status === 'OPEN';
}

/**
 * Payment is allowed while the pool is open. A closed pool has been reconciled
 * by the organiser, so accepting money into it would create a balance nobody is
 * expecting.
 */
export function acceptsPayment(poolStatus: AkawoPoolStatus, dueStatus: AkawoDueStatus): boolean {
  return poolStatus === 'OPEN' && dueStatus === 'PENDING';
}

/**
 * Which pool transitions an organiser may make. DRAFT exists so a pool can be
 * created and checked before its code is shared; CANCELLED is for a pool that
 * should never have existed, and is refused once money has arrived.
 */
export function canTransition(from: AkawoPoolStatus, to: AkawoPoolStatus): boolean {
  if (from === 'DRAFT') return to === 'OPEN' || to === 'CANCELLED';
  if (from === 'OPEN') return to === 'CLOSED' || to === 'CANCELLED';
  // CLOSED and CANCELLED are terminal: reopening would let the organiser collect
  // against a record they have already reconciled and exported.
  return false;
}

/**
 * Cancelling a pool that has taken money would strand it: there is no refund
 * workflow, so the honest answer is to refuse and make the organiser close it.
 */
export function canCancel(status: AkawoPoolStatus, paidCount: number): boolean {
  return canTransition(status, 'CANCELLED') && paidCount === 0;
}

/** A member may only be removed while they owe nothing that has been paid. */
export function canRemoveMember(dueStatus: AkawoDueStatus): boolean {
  return dueStatus === 'PENDING' || dueStatus === 'WAIVED';
}

/** Progress in basis points, so no rounding happens before the client. */
export function collectionProgressBps(paidMinor: bigint, expectedMinor: bigint): number {
  if (expectedMinor <= 0n) return 0;
  const bps = (paidMinor * 10_000n) / expectedMinor;
  return Number(bps > 10_000n ? 10_000n : bps);
}

/**
 * Join codes are shown once and never stored in the clear. Ambiguous characters
 * are excluded because these are read aloud in a lecture hall and typed by hand.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isValidJoinCodeShape(code: string): boolean {
  const normalized = normalizeJoinCode(code);
  return normalized.length === 8 && [...normalized].every((c) => CODE_ALPHABET.includes(c));
}

/** Codes are compared case-insensitively with spacing and dashes ignored. */
export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function generateJoinCode(randomBytes: Uint8Array): string {
  return [...randomBytes.slice(0, 8)]
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('');
}
