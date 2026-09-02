import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AkawoDueStatus,
  FinancialAccountPurpose,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PaymentIntentStatus,
  PaymentMethod,
  PaymentTargetType,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FeesService } from '../fees/fees.service.js';
import { TransactionPinService } from '../auth/transaction-pin.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  MINIMUM_DEPOSIT_MINOR,
  INTENT_TTL_MS,
  canPayFromWallet,
  isPayable,
  isPayableAmount,
  settlesSynchronously,
  totalFor,
} from './domain/payment-policy.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import type { CreateIntentDto } from './dto/create-intent.dto.js';
import type { ConfirmIntentDto } from './dto/confirm-intent.dto.js';

/** What a target resolves to: how much, in what currency, and a label. */
interface ResolvedTarget {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly description: string;
}

export interface PaymentIntentView {
  readonly id: string;
  readonly status: PaymentIntentStatus;
  readonly targetType: PaymentTargetType;
  readonly targetId: string | null;
  readonly amountMinor: string;
  readonly feeMinor: string;
  readonly totalMinor: string;
  readonly currency: string;
  readonly method: PaymentMethod | null;
  readonly description: string;
  readonly expiresAt: string;
  readonly settledAt: string | null;
  readonly failureReason: string | null;
  readonly transferInstructions?: unknown;
  readonly checkoutUrl?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
    private readonly pins: TransactionPinService,
    private readonly audit: AuditService,
    private readonly fees: FeesService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Creates an intent for a target.
   *
   * The amount comes from `resolveTarget`, which reads it from the target row —
   * never from the request — so a caller cannot settle a large due for one
   * naira. A wallet top-up is the one exception, because it has no row to read:
   * there the user is choosing how much of their own money to bring in.
   */
  async create(
    userId: string,
    dto: CreateIntentDto,
    idempotencyKey: string,
  ): Promise<PaymentIntentView> {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    // A retried tap returns the original intent rather than an error: the client
    // that retried needs the same answer, not a conflict it cannot act on.
    if (existing) return this.view(existing, (await this.describe(existing.targetType)) ?? '');

    const target = await this.resolveTarget(
      this.prisma,
      userId,
      dto.targetType,
      dto.targetId ?? null,
      dto.amountMinor === undefined ? null : BigInt(dto.amountMinor),
    );
    if (!isPayableAmount(target.amountMinor)) {
      throw new UnprocessableEntityException('This item has nothing to pay');
    }

    // Deposits are the only target that funds the wallet from outside, so they
    // carry the deposit fee; everything else moves money already inside the
    // ledger and is not charged again. See ADR-009.
    const feeMinor =
      dto.targetType === PaymentTargetType.WALLET_TOPUP
        ? (await this.fees.assess('DEPOSIT', target.amountMinor)).amountMinor
        : 0n;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currency: target.currency },
      select: { id: true },
    });

    try {
      const intent = await this.prisma.paymentIntent.create({
        data: {
          userId,
          ...(wallet ? { walletId: wallet.id } : {}),
          targetType: dto.targetType,
          ...(dto.targetId ? { targetId: dto.targetId } : {}),
          amountMinor: target.amountMinor,
          feeMinor,
          totalMinor: totalFor(target.amountMinor, feeMinor),
          currency: target.currency,
          idempotencyKey,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
      return this.view(intent, target.description);
    } catch (error) {
      // Two concurrent taps: the loser reads the winner's row rather than
      // failing, which is the same outcome the client would have got.
      const raced = await this.prisma.paymentIntent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (raced) return this.view(raced, target.description);
      throw error;
    }
  }

  /**
   * Confirms an intent with a method and the transaction PIN.
   *
   * The PIN is verified before the intent moves out of REQUIRES_CONFIRMATION, so
   * a mistyped digit leaves the payment retryable instead of burning it.
   */
  async confirm(
    userId: string,
    intentId: string,
    dto: ConfirmIntentDto,
    idempotencyKey: string,
  ): Promise<PaymentIntentView> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: intentId, userId },
    });
    if (!intent) throw new NotFoundException('Payment was not found');

    // Already settled by an earlier identical request: return it unchanged
    // rather than charging a second time.
    if (intent.status !== PaymentIntentStatus.REQUIRES_CONFIRMATION) {
      return this.view(intent, (await this.describe(intent.targetType)) ?? '');
    }
    if (!isPayable(intent.status, intent.expiresAt, new Date())) {
      throw new ConflictException('This payment has expired. Start it again.');
    }

    await this.pins.verifyPin(userId, dto.transactionPin);

    return settlesSynchronously(dto.method)
      ? this.settleFromWallet(userId, intentId, idempotencyKey)
      : this.startExternal(userId, intentId, dto.method);
  }

  /**
   * Moves money for a wallet payment and transitions the target, atomically.
   *
   * Everything happens in one serializable transaction: the balance check, the
   * ledger posting, and the target's transition. A crash between any two of
   * those would otherwise leave a due marked paid with no money behind it, or
   * money taken with the due still outstanding.
   */
  private async settleFromWallet(
    userId: string,
    intentId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntentView> {
    const settled = await this.transactions.serializable(async (tx) => {
      const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, userId } });
      if (!intent) throw new NotFoundException('Payment was not found');
      if (intent.status !== PaymentIntentStatus.REQUIRES_CONFIRMATION) return intent;
      if (!intent.walletId) {
        throw new UnprocessableEntityException('No wallet is available for this currency');
      }

      // Re-resolved inside the transaction: the amount is only trustworthy if
      // the target still says so at the moment money moves.
      const target = await this.resolveTarget(
        tx,
        userId,
        intent.targetType,
        intent.targetId,
        intent.amountMinor,
      );
      if (target.amountMinor !== intent.amountMinor) {
        throw new ConflictException('The amount changed. Start this payment again.');
      }

      const accounts = await this.accounts(tx, intent.walletId, intent.currency);
      const available = await this.ledger.accountBalanceWithin(tx, accounts.available.id);
      if (!canPayFromWallet(available, intent.totalMinor)) {
        throw new UnprocessableEntityException('Your wallet balance is not enough');
      }

      const posting = await this.ledger.postWithin(tx, {
        idempotencyKey: `payment-intent:${intent.id}:${idempotencyKey}`,
        reference: `PAY-${intent.id.slice(0, 8).toUpperCase()}`,
        description: target.description.slice(0, 500),
        currency: intent.currency,
        initiatedByUserId: userId,
        correlationId: intent.id,
        entries: [
          {
            accountId: accounts.available.id,
            direction: 'DEBIT',
            amountMinor: intent.totalMinor,
          },
          {
            accountId: accounts.destination.id,
            direction: 'CREDIT',
            amountMinor: intent.amountMinor,
          },
          // Only present when a fee is actually charged, so a zero-fee target
          // does not put an empty row in the ledger.
          ...(intent.feeMinor > 0n
            ? [
                {
                  accountId: accounts.feeRevenue.id,
                  direction: 'CREDIT' as const,
                  amountMinor: intent.feeMinor,
                },
              ]
            : []),
        ],
      });

      await this.transitionTarget(tx, intent.targetType, intent.targetId, posting.id);

      return tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.SUCCEEDED,
          method: PaymentMethod.WALLET,
          ledgerTransactionId: posting.id,
          confirmedAt: new Date(),
          settledAt: new Date(),
        },
      });
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'payment.settled',
      subjectType: 'PaymentIntent',
      subjectId: settled.id,
      metadata: {
        targetType: settled.targetType,
        amountMinor: settled.amountMinor.toString(),
        method: 'WALLET',
      },
    });

    return this.view(settled, (await this.describe(settled.targetType)) ?? '');
  }

  /**
   * Hands a transfer or card payment to the provider.
   *
   * The intent stops at PROCESSING. Nothing here may mark it succeeded: per
   * ADR-006 only a signature-verified webhook is trusted to say an external
   * payment completed.
   */
  private async startExternal(
    userId: string,
    intentId: string,
    method: PaymentMethod,
  ): Promise<PaymentIntentView> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: intentId, userId },
    });
    if (!intent) throw new NotFoundException('Payment was not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const target = await this.resolveTarget(
      this.prisma,
      userId,
      intent.targetType,
      intent.targetId,
      intent.amountMinor,
    );

    const input = {
      internalReference: `PAY-${intent.id.slice(0, 8).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      amountMinor: intent.totalMinor,
      currency: intent.currency,
      customerEmail: user?.email ?? '',
      description: target.description,
    };
    const charge =
      method === PaymentMethod.CARD
        ? await this.provider.createCardCharge(input)
        : await this.provider.createTransferCharge(input);

    const updated = await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: PaymentIntentStatus.PROCESSING,
        method,
        providerReference: charge.providerReference,
        confirmedAt: new Date(),
      },
    });

    return {
      ...this.view(updated, target.description),
      ...(charge.transferInstructions ? { transferInstructions: charge.transferInstructions } : {}),
      ...(charge.checkoutUrl ? { checkoutUrl: charge.checkoutUrl } : {}),
    };
  }

  async get(userId: string, intentId: string): Promise<PaymentIntentView> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: intentId, userId },
    });
    if (!intent) throw new NotFoundException('Payment was not found');
    const target = await this.resolveTarget(
      this.prisma,
      userId,
      intent.targetType,
      intent.targetId,
    ).catch(() => null);
    return this.view(intent, target?.description ?? '');
  }

  /** Available wallet balance, so the client can offer or grey out the wallet. */
  async balance(userId: string, currency = 'NGN'): Promise<unknown> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, currency },
      select: { id: true, currency: true },
    });
    if (!wallet) return { availableMinor: '0', currency };

    const account = await this.prisma.financialAccount.findFirst({
      where: {
        walletId: wallet.id,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        currency,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) return { availableMinor: '0', currency };

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId: account.id, transaction: { status: LedgerTransactionStatus.POSTED } },
      select: { direction: true, amountMinor: true },
    });
    const available = entries.reduce(
      (sum, entry) =>
        entry.direction === LedgerEntryDirection.CREDIT
          ? sum + entry.amountMinor
          : sum - entry.amountMinor,
      0n,
    );
    return { availableMinor: available.toString(), currency };
  }

  /**
   * Reads what a target costs, and proves the caller is allowed to pay it.
   *
   * Authorisation lives here rather than in the controller because this is the
   * one place every payment passes through, on both create and settle.
   */
  private async resolveTarget(
    client: PrismaService | TransactionClient,
    userId: string,
    targetType: PaymentTargetType,
    targetId: string | null,
    /**
     * Only consulted for a wallet top-up, which has no row to read an amount
     * from. On settlement this is the amount already stored on the intent, so
     * the re-resolution still compares against what the user was quoted rather
     * than against a fresh client value.
     */
    requestedAmountMinor: bigint | null = null,
  ): Promise<ResolvedTarget> {
    switch (targetType) {
      case PaymentTargetType.AKAWO_POOL_DUE: {
        if (!targetId) throw new BadRequestException('A due is required');
        const due = await client.akawoPoolDue.findUnique({
          where: { id: targetId },
          include: { pool: { select: { name: true } }, member: { select: { userId: true } } },
        });
        if (!due) throw new NotFoundException('This payment was not found');
        // Scoped to the member who owes it: one member must not be able to pay,
        // or probe the amount of, another's due.
        if (due.member.userId !== userId) {
          throw new NotFoundException('This payment was not found');
        }
        if (due.status !== AkawoDueStatus.PENDING) {
          throw new ConflictException('This has already been settled');
        }
        return {
          amountMinor: due.amountMinor,
          currency: due.currency,
          description: `Akawo pool: ${due.pool.name}`,
        };
      }
      case PaymentTargetType.WALLET_TOPUP: {
        // The one target with no row to read an amount from: the user chooses
        // how much of their own money to bring in. Accepted here and nowhere
        // else, so it cannot be used to underpay a due that has its own amount.
        if (requestedAmountMinor === null) {
          throw new UnprocessableEntityException('Choose how much you want to add');
        }
        if (requestedAmountMinor < MINIMUM_DEPOSIT_MINOR) {
          throw new UnprocessableEntityException(
            `The smallest amount you can add is ${(MINIMUM_DEPOSIT_MINOR / 100n).toString()} naira`,
          );
        }
        const wallet = await client.wallet.findFirst({
          where: { userId },
          select: { currency: true },
        });
        return {
          amountMinor: requestedAmountMinor,
          currency: wallet?.currency ?? 'NGN',
          description: 'Wallet top-up',
        };
      }
      case PaymentTargetType.AJO_CONTRIBUTION:
      case PaymentTargetType.FOOD_SUBSCRIPTION:
        throw new UnprocessableEntityException('This payment type is not available yet');
      default: {
        // Exhaustiveness: adding a target type without a branch fails to compile
        // rather than silently resolving to nothing.
        const unreachable: never = targetType;
        throw new BadRequestException(`Unsupported payment target: ${String(unreachable)}`);
      }
    }
  }

  /**
   * Transitions the paid-for thing, in the same transaction as the posting.
   *
   * This is the only place an Akawo due may reach PAID, which is what ADR-007
   * requires: the pool module contains no path that writes it.
   */
  private async transitionTarget(
    tx: TransactionClient,
    targetType: PaymentTargetType,
    targetId: string | null,
    ledgerTransactionId: string,
  ): Promise<void> {
    if (targetType === PaymentTargetType.AKAWO_POOL_DUE && targetId) {
      await tx.akawoPoolDue.update({
        where: { id: targetId },
        data: {
          status: AkawoDueStatus.PAID,
          ledgerTransactionId,
          paidAt: new Date(),
        },
      });
    }
  }

  /** A short human label for a target type, used when the row is gone. */
  private describe(targetType: PaymentTargetType): Promise<string> {
    const labels: Record<PaymentTargetType, string> = {
      AKAWO_POOL_DUE: 'Akawo pool payment',
      AJO_CONTRIBUTION: 'Ajo contribution',
      FOOD_SUBSCRIPTION: 'Food subscription',
      WALLET_TOPUP: 'Wallet top-up',
    };
    return Promise.resolve(labels[targetType]);
  }

  /**
   * The accounts a payment moves between.
   *
   * `destination` is provider-payable: money leaving a wallet for a pool is held
   * there until it is disbursed, so it is never simply removed from the books.
   */
  private async accounts(tx: TransactionClient, walletId: string, currency: string) {
    const [available, destination, feeRevenue] = await Promise.all([
      tx.financialAccount.findFirst({
        where: {
          walletId,
          purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
          currency,
          isActive: true,
        },
      }),
      tx.financialAccount.findFirst({
        where: {
          walletId: null,
          purpose: FinancialAccountPurpose.PROVIDER_PAYABLE,
          currency,
          isActive: true,
        },
      }),
      tx.financialAccount.findFirst({
        where: {
          walletId: null,
          purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
          currency,
          isActive: true,
        },
      }),
    ]);
    if (!available || !destination || !feeRevenue) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return { available, destination, feeRevenue };
  }

  /** BigInt money is serialised as strings, per the repository-wide convention. */
  private view(
    intent: {
      id: string;
      status: PaymentIntentStatus;
      targetType: PaymentTargetType;
      targetId: string | null;
      amountMinor: bigint;
      feeMinor: bigint;
      totalMinor: bigint;
      currency: string;
      method: PaymentMethod | null;
      expiresAt: Date;
      settledAt: Date | null;
      failureReason: string | null;
    },
    description: string,
  ): PaymentIntentView {
    return {
      id: intent.id,
      status: intent.status,
      targetType: intent.targetType,
      targetId: intent.targetId,
      amountMinor: intent.amountMinor.toString(),
      feeMinor: intent.feeMinor.toString(),
      totalMinor: intent.totalMinor.toString(),
      currency: intent.currency,
      method: intent.method,
      description,
      expiresAt: intent.expiresAt.toISOString(),
      settledAt: intent.settledAt?.toISOString() ?? null,
      failureReason: intent.failureReason,
    };
  }
}
