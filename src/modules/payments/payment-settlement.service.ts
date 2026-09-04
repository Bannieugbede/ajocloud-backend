import { Injectable, Logger } from '@nestjs/common';
import { FinancialAccountPurpose, PaymentIntentStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { formatMoney } from '../notifications/domain/notification-money.js';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';

export type SettlementOutcome =
  | { readonly status: 'SETTLED'; readonly intentId: string }
  | { readonly status: 'FAILED'; readonly intentId: string }
  | { readonly status: 'UNMATCHED' }
  | { readonly status: 'ALREADY_SETTLED'; readonly intentId: string };

/**
 * Completes an external payment once a verified webhook says it succeeded
 * (ADR-006, ADR-010).
 *
 * This is the only path by which money enters the platform, so it is
 * deliberately narrow: it resolves an intent by the provider's reference, posts
 * the ledger legs, and does nothing else. It does not recompute the fee — the
 * amount stored on the intent is what the user was quoted, and re-deriving it
 * here could charge something different if a definition version changed in
 * between.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
    private readonly notifications: TransactionalNotificationService,
  ) {}

  /**
   * Credits the wallet a successful deposit paid for.
   *
   * The fee is netted from the credit rather than charged as its own debit: the
   * user sent one amount and there is no second opportunity to collect, so a
   * separate fee debit could fail against an empty wallet and leave the ledger
   * describing a fee that was never taken.
   */
  async settleSuccessful(providerReference: string): Promise<SettlementOutcome> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { providerReference },
      select: { id: true, status: true },
    });
    // An event matching no intent is not guessed at; unmatched settlements
    // belong to reconciliation, which has its own record type.
    if (!intent) return { status: 'UNMATCHED' };
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      return { status: 'ALREADY_SETTLED', intentId: intent.id };
    }

    const settled = await this.transactions.serializable(async (tx) => {
      const current = await tx.paymentIntent.findUnique({
        where: { id: intent.id },
        select: {
          id: true,
          userId: true,
          walletId: true,
          status: true,
          amountMinor: true,
          feeMinor: true,
          currency: true,
        },
      });
      if (!current) return { status: 'UNMATCHED' } as const;
      // Re-read inside the transaction: two deliveries can both pass the check
      // above, and a duplicate credit is unrecoverable once it is spent.
      if (current.status === PaymentIntentStatus.SUCCEEDED) {
        return { status: 'ALREADY_SETTLED', intentId: current.id } as const;
      }

      const accounts = await this.accountsFor(tx, current.userId, current.currency);
      const creditedMinor = current.amountMinor - current.feeMinor;

      const posting = await this.ledger.postWithin(tx, {
        // Derived from the intent, not the event: a same-payment event arriving
        // under a new provider event id still cannot post twice.
        idempotencyKey: `payment-settlement:${current.id}`,
        reference: `DEP-${current.id.slice(0, 8).toUpperCase()}`,
        description: 'Wallet deposit',
        currency: current.currency,
        correlationId: current.id,
        entries: [
          {
            // Gross: what the provider actually holds on our behalf.
            accountId: accounts.providerPayable.id,
            direction: 'DEBIT',
            amountMinor: current.amountMinor,
          },
          {
            accountId: accounts.available.id,
            direction: 'CREDIT',
            amountMinor: creditedMinor,
          },
          ...(current.feeMinor > 0n
            ? [
                {
                  accountId: accounts.feeRevenue.id,
                  direction: 'CREDIT' as const,
                  amountMinor: current.feeMinor,
                },
              ]
            : []),
        ],
      });

      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: PaymentIntentStatus.SUCCEEDED,
          ledgerTransactionId: posting.id,
          settledAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: current.userId,
          action: 'payment.settled',
          subjectType: 'PaymentIntent',
          subjectId: current.id,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PaymentIntent',
          aggregateId: current.id,
          eventType: 'payment.settled',
          payload: { intentId: current.id, creditedMinor: creditedMinor.toString() },
        },
      });
      return {
        status: 'SETTLED',
        intentId: current.id,
        notify: {
          userId: current.userId,
          creditedMinor,
          currency: current.currency,
        },
      } as const;
    });

    // Only the branch that actually posted carries a notification: every other
    // outcome — unmatched, or already settled by a concurrent delivery —
    // returns without one, so there is nothing here to announce.
    if (settled.status === 'SETTLED' && 'notify' in settled) {
      const { intentId } = settled;
      const { userId, creditedMinor, currency } = settled.notify;
      // After the transaction, never inside it: a "wallet funded" push sent
      // from within would announce a credit that could still roll back, and it
      // cannot be unsent. Not awaited, because a notification provider being
      // down must not turn a settled deposit into a webhook the provider
      // retries — that retry would be answered by the idempotency check, but
      // the failure would be logged as though money had not moved.
      void this.notifications
        .notify({
          userId,
          template: 'wallet-funded',
          // The credited amount, not the gross: this is what arrived in the
          // wallet, and quoting the pre-fee figure would not match the balance.
          variables: { amount: formatMoney(creditedMinor, currency) },
          storedPayload: { intentId },
          dedupeKey: `wallet-funded:${intentId}`,
        })
        .catch(() => {
          // notify records its own failures; the money has moved either way.
        });
    }

    return settled.status === 'SETTLED'
      ? { status: 'SETTLED', intentId: settled.intentId }
      : settled;
  }

  /** Records a provider failure. Nothing is posted, because no money moved. */
  async settleFailed(providerReference: string, reason: string): Promise<SettlementOutcome> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { providerReference },
      select: { id: true, status: true, userId: true },
    });
    if (!intent) return { status: 'UNMATCHED' };
    if (intent.status === PaymentIntentStatus.SUCCEEDED) {
      // A success already posted cannot be undone by a later failure event;
      // that is a reversal, which ADR-010 leaves to reconciliation.
      this.logger.warn('Failure event for an already settled payment; left for reconciliation');
      return { status: 'ALREADY_SETTLED', intentId: intent.id };
    }
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PaymentIntentStatus.FAILED,
        failureReason: reason.slice(0, 500),
      },
    });
    return { status: 'FAILED', intentId: intent.id };
  }

  /** The three accounts a deposit touches, created on first use. */
  private async accountsFor(tx: TransactionClient, userId: string, currency: string) {
    const wallet = await tx.wallet.findFirst({
      where: { userId, currency },
      select: { id: true },
    });
    if (!wallet) throw new Error('The paying user has no wallet in this currency');

    const available = await tx.financialAccount.findFirstOrThrow({
      where: { walletId: wallet.id, purpose: FinancialAccountPurpose.WALLET_AVAILABLE },
      select: { id: true },
    });
    const providerPayable = await tx.financialAccount.findFirstOrThrow({
      where: { purpose: FinancialAccountPurpose.PROVIDER_PAYABLE, currency },
      select: { id: true },
    });
    const feeRevenue = await tx.financialAccount.findFirstOrThrow({
      where: { purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE, currency },
      select: { id: true },
    });
    return { available, providerPayable, feeRevenue };
  }
}
