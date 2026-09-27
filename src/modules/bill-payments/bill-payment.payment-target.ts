import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentTargetType } from '../../../generated/prisma/enums.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import type {
  AfterCommitOutcome,
  ConfirmationDetails,
  PaymentTarget,
  PaymentTargetClient,
  ResolvedTarget,
  SettledPayment,
} from '../payments/targets/payment-target.js';
import { BillPaymentsService } from './bill-payments.service.js';

/**
 * A bill — airtime, data, electricity, TV — paid through the shared payment
 * flow, so it gets the same quote, PIN, top-up and result as every other
 * payment. See ADR-014.
 *
 * The target is the customer validation the payment quotes, which binds it to
 * the one number the payer was shown. Unlike the other targets a bill is not
 * finished when money moves: the transaction moves the money into the payer's
 * reserve and records the bill, and the provider is called after it commits.
 * The fee is held with the amount until then, so a refused bill returns all of
 * it.
 */
@Injectable()
export class BillPaymentTarget implements PaymentTarget {
  readonly type = PaymentTargetType.BILL_PAYMENT;
  readonly methods = [PaymentMethod.WALLET] as const;
  /**
   * Chosen, because airtime and electricity are priced by the payer. A
   * fixed-price package still refuses any other figure in `resolve`.
   */
  readonly amountRule = 'chosen' as const;
  readonly feeCode = 'BILL_PAYMENT' as const;
  readonly holdsFee = true;

  constructor(private readonly bills: BillPaymentsService) {}

  resolve(
    client: PaymentTargetClient,
    userId: string,
    targetId: string | null,
    requestedAmountMinor: bigint | null,
  ): Promise<ResolvedTarget> {
    return this.bills.quoteForIntent(client, userId, targetId, requestedAmountMinor);
  }

  creditAccount(tx: TransactionClient, targetId: string | null, currency: string) {
    return this.bills.reservedAccountForIntent(tx, targetId, currency);
  }

  settle(tx: TransactionClient, payment: SettledPayment): Promise<void> {
    return this.bills.recordIntentPayment(tx, payment);
  }

  describe(client: PaymentTargetClient, targetId: string | null): Promise<string> {
    return this.bills.describeIntent(client, targetId).catch(() => 'Bill payment');
  }

  verifyConfirmation(
    client: PaymentTargetClient,
    userId: string,
    targetId: string | null,
    details: ConfirmationDetails,
  ): Promise<void> {
    return this.bills.verifyIntentReference(client, userId, targetId, details.customerReference);
  }

  afterCommit(payment: SettledPayment, details: ConfirmationDetails): Promise<AfterCommitOutcome> {
    return this.bills.completeIntentPayment(
      payment.userId,
      payment.intentId,
      details.customerReference,
    );
  }
}
