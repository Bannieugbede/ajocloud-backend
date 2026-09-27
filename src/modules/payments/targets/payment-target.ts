import type { PaymentMethod, PaymentTargetType } from '../../../../generated/prisma/enums.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { FeeCode } from '../../fees/fees.service.js';
import type { TransactionClient } from '../../../infrastructure/database/transaction.service.js';

/** Either the root client or a transaction, so a target resolves the same way in both. */
export type PaymentTargetClient = PrismaService | TransactionClient;

/**
 * How a target's amount is decided.
 *
 * - `fixed`: read from the target row. A requested amount is refused, so a
 *   payer cannot settle a large due for one naira.
 * - `chosen`: named by the payer, because there is no row to read one from.
 *   Only a wallet top-up works this way.
 * - `partial`: read from the row, but the payer may choose to pay less of it
 *   now. Safe only where the row's status is derived from what has actually
 *   arrived, so a part payment can never mark it paid.
 */
export type PaymentAmountRule = 'fixed' | 'chosen' | 'partial';

/** What a target costs right now, and how to describe it to the payer. */
export interface ResolvedTarget {
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Shown on the payment screens and written to the ledger, e.g. "Ajo: Class of 2026, round 3". */
  readonly description: string;
}

/** Everything a target needs to record that it has been paid. */
export interface SettledPayment {
  readonly userId: string;
  readonly targetId: string | null;
  readonly intentId: string;
  readonly amountMinor: bigint;
  /** The fee charged on top, already debited with the amount. */
  readonly feeMinor: bigint;
  readonly currency: string;
  readonly ledgerTransactionId: string;
}

/**
 * Details a payer supplies when confirming, used for that one confirmation and
 * never stored. A bill payment needs the customer's number to send to the
 * provider, and only a digest of it is kept.
 */
export interface ConfirmationDetails {
  readonly customerReference?: string;
}

/** Where a payment completed after its transaction ended up. */
export type AfterCommitOutcome = 'SUCCEEDED' | 'FAILED' | 'PROCESSING';

/**
 * One kind of thing a member can pay for: an Akawo pool due, an Ajo
 * contribution, a Food subscription, a wallet top-up.
 *
 * `PaymentsService` owns the mechanics every payment shares — idempotency, the
 * PIN, the balance check, the ledger posting, expiry — and asks the target only
 * the questions that differ between products. Adding a product is implementing
 * this interface and registering it in `PaymentsModule`; nothing in the
 * service changes. See ADR-013.
 */
export interface PaymentTarget {
  readonly type: PaymentTargetType;

  /**
   * The methods this target can be paid with, in the order to offer them.
   *
   * Returned on every intent, so the client offers exactly what the server will
   * accept. A product target is paid from the wallet only: the external rails
   * settle by crediting a wallet (ADR-010), so a card payment for a due would
   * land as a deposit and leave the due unpaid.
   */
  readonly methods: readonly PaymentMethod[];

  readonly amountRule: PaymentAmountRule;

  /**
   * The fee this target is charged, if any. Assessed on the amount when the
   * intent is created and shown in its quote.
   */
  readonly feeCode?: FeeCode;

  /**
   * Credit the fee to `creditAccount` with the amount, rather than to fee
   * revenue at once. For a target that may still fail after money moves: the
   * fee is only earned when the target completes, and until then it must be
   * returnable with the rest.
   */
  readonly holdsFee?: boolean;

  /**
   * Reads what the target costs and proves `userId` may pay it.
   *
   * Called when the intent is created, and again inside the settlement
   * transaction, so the amount is only trusted if the target still says so when
   * money moves. `requestedAmountMinor` is null unless `amountRule` allows one,
   * and on settlement it is the amount already stored on the intent.
   *
   * Authorisation lives here because this is the one place every payment
   * passes through. A target that is not the caller's must report as not
   * found, so the endpoint cannot be used to probe other members' dues.
   */
  resolve(
    client: PaymentTargetClient,
    userId: string,
    targetId: string | null,
    requestedAmountMinor: bigint | null,
  ): Promise<ResolvedTarget>;

  /**
   * The ledger account the payment is credited to, created on first use.
   * Called inside the settlement transaction.
   */
  creditAccount(
    tx: TransactionClient,
    targetId: string | null,
    currency: string,
  ): Promise<{ readonly id: string }>;

  /**
   * Records the payment against the target, in the same transaction as the
   * ledger posting. A crash between the two would otherwise leave money taken
   * with the due still outstanding, or a due paid with no money behind it.
   */
  settle(tx: TransactionClient, payment: SettledPayment): Promise<void>;

  /**
   * A label for a target that may no longer be payable, such as one already
   * settled. Never throws: it is for display on a receipt, not authorisation.
   */
  describe(client: PaymentTargetClient, targetId: string | null): Promise<string>;

  /**
   * Checks what the payer supplied with the confirmation, before the PIN is
   * verified, so a missing or mismatched detail costs no PIN attempt.
   */
  verifyConfirmation?(
    client: PaymentTargetClient,
    userId: string,
    targetId: string | null,
    details: ConfirmationDetails,
  ): Promise<void>;

  /**
   * Work that must happen after the settlement transaction commits, because it
   * calls out to a provider and no transaction may be held across network I/O.
   *
   * A target that has this is left PROCESSING by the transaction; the outcome
   * returned here decides where the intent ends. It must not throw for a
   * provider failure: money is already held, so an uncertain result is
   * `PROCESSING` and a refused one is `FAILED` with the money returned.
   */
  afterCommit?(payment: SettledPayment, details: ConfirmationDetails): Promise<AfterCommitOutcome>;
}

/** Nest token for the registry of every target, keyed by type. */
export const PAYMENT_TARGETS = Symbol('PAYMENT_TARGETS');

export type PaymentTargetRegistry = Readonly<Record<PaymentTargetType, PaymentTarget>>;

/**
 * Builds the registry, refusing a missing or duplicated type at boot rather
 * than at the first payment for it.
 */
export function paymentTargetRegistry(
  types: readonly PaymentTargetType[],
  targets: readonly PaymentTarget[],
): PaymentTargetRegistry {
  const registry: Partial<Record<PaymentTargetType, PaymentTarget>> = {};
  for (const target of targets) {
    if (registry[target.type]) {
      throw new Error(`Payment target ${target.type} is registered twice`);
    }
    registry[target.type] = target;
  }
  const missing = types.filter((type) => !registry[type]);
  if (missing.length > 0) {
    throw new Error(`No payment target is registered for ${missing.join(', ')}`);
  }
  return registry as PaymentTargetRegistry;
}
