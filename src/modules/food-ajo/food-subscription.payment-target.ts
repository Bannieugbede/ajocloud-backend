import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AccountType,
  FinancialAccountPurpose,
  FoodSubscriptionStatus,
  PaymentMethod,
  PaymentTargetType,
} from '../../../generated/prisma/enums.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type {
  PaymentTarget,
  PaymentTargetClient,
  ResolvedTarget,
  SettledPayment,
} from '../payments/targets/payment-target.js';
import {
  acceptsPayment,
  canRefundSubscription,
  escrowAccountCode,
  subscriptionTotalMinor,
} from './domain/food-ajo-policy.js';

/**
 * A member's enrolment in a Food Ajo programme. The target id is the
 * subscription.
 *
 * Paid in full, once: the price is the package's locked price for each
 * portion, and paying it moves the subscription from PENDING to ACTIVE. The
 * money is held in the programme's own escrow account until it is spent on
 * procurement, and refunded from there if the member withdraws first.
 */
@Injectable()
export class FoodSubscriptionTarget implements PaymentTarget {
  readonly type = PaymentTargetType.FOOD_SUBSCRIPTION;
  readonly methods = [PaymentMethod.WALLET] as const;
  readonly amountRule = 'fixed' as const;

  constructor(private readonly ledger: LedgerService) {}

  async resolve(
    client: PaymentTargetClient,
    userId: string,
    subscriptionId: string | null,
  ): Promise<ResolvedTarget> {
    const subscription = await this.owned(client, userId, subscriptionId);

    if (subscription.status === FoodSubscriptionStatus.ACTIVE) {
      throw new ConflictException('This enrolment has already been paid');
    }
    if (subscription.status !== FoodSubscriptionStatus.PENDING) {
      throw new ConflictException('This enrolment can no longer be paid');
    }
    if (!acceptsPayment(subscription.group.status)) {
      throw new ConflictException('This programme is not collecting payments');
    }

    const outstanding =
      subscriptionTotalMinor(subscription.package.priceMinor, subscription.quantity) -
      subscription.amountPaidMinor;
    if (outstanding <= 0n) throw new ConflictException('This enrolment has already been paid');

    return {
      amountMinor: outstanding,
      currency: subscription.package.currency,
      description: this.label(subscription),
    };
  }

  async creditAccount(tx: TransactionClient, subscriptionId: string | null, currency: string) {
    const subscription = subscriptionId
      ? await tx.foodSubscription.findUnique({
          where: { id: subscriptionId },
          select: { groupId: true },
        })
      : null;
    if (!subscription) throw new NotFoundException('That enrolment was not found');
    return this.escrowAccountWithin(tx, subscription.groupId, currency);
  }

  async settle(tx: TransactionClient, payment: SettledPayment): Promise<void> {
    const subscription = await this.owned(tx, payment.userId, payment.targetId);
    const amountPaidMinor = subscription.amountPaidMinor + payment.amountMinor;
    const total = subscriptionTotalMinor(subscription.package.priceMinor, subscription.quantity);

    await tx.foodSubscription.update({
      where: { id: subscription.id },
      data: {
        amountPaidMinor,
        // Derived from the amounts, so an enrolment cannot become ACTIVE short.
        ...(amountPaidMinor >= total
          ? { status: FoodSubscriptionStatus.ACTIVE, paidAt: new Date() }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: payment.userId,
        action: 'food.subscription.paid',
        subjectType: 'FoodSubscription',
        subjectId: subscription.id,
        metadata: {
          paymentIntentId: payment.intentId,
          amountMinor: payment.amountMinor.toString(),
        },
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'FoodSubscription',
        aggregateId: subscription.id,
        eventType: 'food.subscription.paid',
        payload: {
          programmeId: subscription.groupId,
          subscriptionId: subscription.id,
          amountMinor: payment.amountMinor.toString(),
        },
      },
    });
  }

  async describe(client: PaymentTargetClient, subscriptionId: string | null): Promise<string> {
    const subscription = subscriptionId
      ? await client.foodSubscription
          .findUnique({
            where: { id: subscriptionId },
            select: {
              quantity: true,
              group: { select: { name: true } },
              package: { select: { name: true } },
            },
          })
          .catch(() => null)
      : null;
    return subscription ? this.label(subscription) : 'Food subscription';
  }

  /**
   * Returns what a member paid for a subscription they are withdrawing from,
   * from the programme's escrow to their wallet, in the caller's transaction.
   *
   * Refused once buying has begun, since the money is then committed to a
   * vendor. Returns the amount refunded, zero when nothing had been paid.
   */
  async refundWithin(
    tx: TransactionClient,
    input: {
      readonly userId: string;
      readonly subscriptionId: string;
      readonly programmeId: string;
      readonly programmeStatus: string;
      readonly amountPaidMinor: bigint;
      /** When the payment being refunded completed; it names the refund. */
      readonly paidAt: Date | null;
      readonly currency: string;
    },
  ): Promise<bigint> {
    if (input.amountPaidMinor <= 0n) return 0n;
    if (!canRefundSubscription(input.programmeStatus)) {
      throw new ConflictException(
        'Buying has begun for this programme, so a paid enrolment can no longer be withdrawn',
      );
    }

    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency: input.currency } },
      select: { id: true },
    });
    const walletAccount = wallet
      ? await tx.financialAccount.findFirst({
          where: {
            walletId: wallet.id,
            purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
            currency: input.currency,
            isActive: true,
          },
          select: { id: true },
        })
      : null;
    if (!walletAccount) {
      throw new UnprocessableEntityException('No wallet is available to refund to');
    }
    const escrow = await this.escrowAccountWithin(tx, input.programmeId, input.currency);

    await this.ledger.postWithin(tx, {
      // One refund per payment: a member who enrols again and pays again has a
      // new paidAt, so their second refund is a new posting, while a retry of
      // this one is refused by the ledger rather than paid twice.
      idempotencyKey: `food-refund:${input.subscriptionId}:${(input.paidAt ?? new Date(0)).getTime()}`,
      reference: `FOOD-REFUND-${input.subscriptionId.slice(0, 8).toUpperCase()}`,
      description: 'Food Ajo enrolment refund',
      currency: input.currency,
      initiatedByUserId: input.userId,
      correlationId: input.programmeId,
      entries: [
        { accountId: escrow.id, direction: 'DEBIT', amountMinor: input.amountPaidMinor },
        { accountId: walletAccount.id, direction: 'CREDIT', amountMinor: input.amountPaidMinor },
      ],
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.userId,
        action: 'food.subscription.refunded',
        subjectType: 'FoodSubscription',
        subjectId: input.subscriptionId,
        metadata: { amountMinor: input.amountPaidMinor.toString() },
      },
    });
    return input.amountPaidMinor;
  }

  /** One programme's escrow account, created on first use. */
  private async escrowAccountWithin(tx: TransactionClient, programmeId: string, currency: string) {
    const code = escrowAccountCode(programmeId);
    const existing = await tx.financialAccount.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        throw new UnprocessableEntityException('This programme’s account is not active');
      }
      return existing;
    }
    return tx.financialAccount.create({
      data: {
        code,
        name: `Food Ajo programme escrow ${programmeId}`,
        // A liability: the money belongs to the members until it buys food.
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.FOOD_PROGRAMME_ESCROW,
        currency,
      },
      select: { id: true, isActive: true },
    });
  }

  /**
   * The subscription, provided it is the caller's. Anything else reports as
   * not found, so the payment endpoint cannot confirm another member's
   * enrolment exists.
   */
  private async owned(client: PaymentTargetClient, userId: string, subscriptionId: string | null) {
    const subscription = subscriptionId
      ? await client.foodSubscription.findUnique({
          where: { id: subscriptionId },
          include: {
            group: { select: { name: true, status: true } },
            package: { select: { name: true, priceMinor: true, currency: true } },
          },
        })
      : null;
    if (!subscription || subscription.userId !== userId) {
      throw new NotFoundException('That enrolment was not found');
    }
    return subscription;
  }

  private label(subscription: {
    readonly quantity: number;
    readonly group: { readonly name: string };
    readonly package: { readonly name: string };
  }): string {
    const portions = subscription.quantity > 1 ? ` × ${subscription.quantity}` : '';
    return `Food: ${subscription.group.name}, ${subscription.package.name}${portions}`;
  }
}
