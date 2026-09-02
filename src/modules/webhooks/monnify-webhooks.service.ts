import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EventProcessingStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentSettlementService } from '../payments/payment-settlement.service.js';
import {
  extractMonnifyEvent,
  type ExtractedMonnifyEvent,
  type MonnifyEventEnvelope,
  type MonnifyEventKind,
} from './domain/monnify-events.js';
import { isWithinTimestampTolerance } from './domain/monnify-signature.js';

const PROVIDER = 'monnify';

export interface WebhookAcknowledgement {
  readonly received: true;
  /** False when this delivery duplicated one already recorded. */
  readonly firstDelivery: boolean;
}

/**
 * Records verified Monnify webhook deliveries (ADR-006).
 *
 * The signature is already verified by `MonnifySignatureGuard` before anything
 * here runs. This service is responsible for the two properties that make
 * webhook handling safe rather than merely functional:
 *
 * 1. **Exactly-once effect.** Monnify retries any non-2xx, so duplicates are
 *    routine. `PaymentWebhookEvent` is unique on `(provider, providerEventId)`,
 *    so a redelivery collides and becomes a no-op instead of a second effect.
 * 2. **Acknowledge fast.** The row is written and 200 returned; nothing slow
 *    happens inside the request. A handler that makes the provider wait turns
 *    one event into a retry storm.
 *
 * No method here mutates a wallet balance. Money movement belongs to
 * `LedgerService`, which enforces balanced double-entry postings and is
 * idempotent on its own key. This class does not open a second path to money.
 */
@Injectable()
export class MonnifyWebhooksService {
  private readonly logger = new Logger(MonnifyWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  async record(
    kind: MonnifyEventKind,
    payload: MonnifyEventEnvelope,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<WebhookAcknowledgement> {
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const event = extractMonnifyEvent(payload, kind, payloadHash);

    const stale = !isWithinTimestampTolerance(event.timestamp ?? undefined, Date.now());
    if (event.routeMismatch) {
      // Not fatal, but it means a dashboard URL is registered against the wrong
      // event type, which will misroute events until someone corrects it.
      this.logger.warn(
        `Monnify ${kind} route received an event declared as ${event.declaredType ?? 'unknown'}`,
      );
    }

    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider: PROVIDER, providerEventId: event.eventId } },
      select: { id: true },
    });
    if (existing) {
      // Redelivery. Acknowledge so Monnify stops retrying; do not reprocess.
      this.logger.log(`Duplicate Monnify ${kind} delivery ignored`);
      return { received: true, firstDelivery: false };
    }

    // Signature digest, not the signature: enough to correlate a delivery with
    // provider-side logs during an investigation, useless if the table leaks.
    const signatureHash = signature
      ? createHash('sha256').update(signature).digest('hex')
      : undefined;

    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: PROVIDER,
          providerEventId: event.eventId,
          payloadHash,
          ...(signatureHash ? { signatureHash } : {}),
          // Recorded, not yet acted on. Ledger posting for each event type is a
          // financial rule that ADR-006 explicitly leaves to a further ADR.
          status: stale ? EventProcessingStatus.FAILED : EventProcessingStatus.PENDING,
          ...(stale ? { failureReason: 'Event timestamp outside tolerance' } : {}),
        },
      });
    } catch (error) {
      // A concurrent delivery of the same event can win the race between the
      // findUnique above and this create. The unique constraint is the
      // authority, so treat that as the duplicate it is.
      if (isUniqueViolation(error)) {
        this.logger.log(`Concurrent duplicate Monnify ${kind} delivery ignored`);
        return { received: true, firstDelivery: false };
      }
      throw error;
    }

    await this.audit.record({
      action: `webhook.monnify.${kind.toLowerCase()}`,
      subjectType: 'PaymentWebhookEvent',
      metadata: {
        kind,
        declaredType: event.declaredType,
        routeMismatch: event.routeMismatch,
        stale,
        // Amounts and references are safe to audit; no identity data reaches
        // this path, and AuditService redacts account numbers regardless.
        amountMinor: event.amountMinor === null ? null : event.amountMinor.toString(),
        currency: event.currency,
        providerReference: event.providerReference,
        internalReference: event.internalReference,
      },
    });

    if (stale) {
      this.logger.warn(`Monnify ${kind} event rejected as stale`);
      return { received: true, firstDelivery: true };
    }

    // Posted only after the event row is durable, so a posting failure leaves
    // the event PENDING for retry rather than costing us the acknowledgement.
    await this.applyToLedger(kind, event);

    return { received: true, firstDelivery: true };
  }

  /**
   * Moves money for the event kinds that represent a completed payment.
   *
   * Deliberately narrow: only a transaction completion credits a wallet, and
   * only against an intent that already exists. Every other kind is recorded
   * and left alone — a settlement or wallet-activity event describes the
   * provider's own books, not ours, and reversals are left to reconciliation
   * while fee refundability is undecided (ADR-010).
   */
  private async applyToLedger(kind: MonnifyEventKind, event: ExtractedMonnifyEvent): Promise<void> {
    if (kind !== 'TRANSACTION_COMPLETION' || !event.providerReference) return;

    const failed = event.declaredType === 'FAILED_TRANSACTION';
    try {
      const outcome = failed
        ? await this.settlement.settleFailed(event.providerReference, 'Provider reported a failure')
        : await this.settlement.settleSuccessful(event.providerReference);

      if (outcome.status === 'UNMATCHED') {
        // Not an error: a payment made outside an intent, or one whose intent
        // was never created. Reconciliation owns these, not this handler.
        this.logger.warn('Monnify transaction matched no payment intent');
        return;
      }
      await this.prisma.paymentWebhookEvent.update({
        where: {
          provider_providerEventId: { provider: PROVIDER, providerEventId: event.eventId },
        },
        data: { status: EventProcessingStatus.PROCESSED, processedAt: new Date() },
      });
    } catch (error) {
      // The event row stays PENDING so it can be retried; the acknowledgement
      // has already been earned by recording it.
      this.logger.error(
        `Monnify ${kind} settlement failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.prisma.paymentWebhookEvent.update({
        where: {
          provider_providerEventId: { provider: PROVIDER, providerEventId: event.eventId },
        },
        data: { failureReason: 'Ledger posting failed; awaiting retry' },
      });
    }
  }
}

/** Prisma's unique-constraint code, checked without importing the error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
