import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
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
  INTENT_TTL_MS,
  canPayFromWallet,
  isPayable,
  isPayableAmount,
  settlesSynchronously,
  totalFor,
} from './domain/payment-policy.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import {
  PAYMENT_TARGETS,
  type ConfirmationDetails,
  type PaymentTarget,
  type PaymentTargetRegistry,
  type SettledPayment,
} from './targets/payment-target.js';
import type { CreateIntentDto } from './dto/create-intent.dto.js';
import type { ConfirmIntentDto } from './dto/confirm-intent.dto.js';

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
  /**
   * The methods this payment accepts, in the order to offer them. The client
   * renders exactly these, so it never offers a method `confirm` would refuse.
   */
  readonly methods: readonly PaymentMethod[];
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
    @Inject(PAYMENT_TARGETS) private readonly targets: PaymentTargetRegistry,
  ) {}

  /**
   * Creates an intent for a target.
   *
   * The amount comes from the target (see `PaymentTarget.amountRule`): read
   * from its row, so a caller cannot settle a large due for one naira; chosen
   * by the payer only for a wallet top-up; or, where the target allows part
   * payment, at most what is still owed.
   */
  async create(
    userId: string,
    dto: CreateIntentDto,
    idempotencyKey: string,
  ): Promise<PaymentIntentView> {
    const handler = this.targets[dto.targetType];
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    // A retried tap returns the original intent rather than an error: the client
    // that retried needs the same answer, not a conflict it cannot act on.
    if (existing) return this.view(existing, await this.describe(existing));

    // The single place a client amount enters. A fixed target refuses one
    // outright rather than ignoring it, so a client that sends one learns it is
    // wrong instead of believing it underpaid successfully.
    const requestedAmountMinor = dto.amountMinor === undefined ? null : BigInt(dto.amountMinor);
    if (requestedAmountMinor !== null && handler.amountRule === 'fixed') {
      throw new UnprocessableEntityException('The amount for this payment cannot be changed');
    }

    const target = await handler.resolve(
      this.prisma,
      userId,
      dto.targetId ?? null,
      requestedAmountMinor,
    );
    if (!isPayableAmount(target.amountMinor)) {
      throw new UnprocessableEntityException('This item has nothing to pay');
    }

    // Deposits are the only target that funds the wallet from outside, so they
    // carry the deposit fee; everything else moves money already inside the
    // ledger and is not charged again. See ADR-009.
    const feeMinor = handler.feeCode
      ? (await this.fees.assess(handler.feeCode, target.amountMinor)).amountMinor
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
      return this.view(intent, await this.describe(intent));
    }
    if (!isPayable(intent.status, intent.expiresAt, new Date())) {
      throw new ConflictException('This payment has expired. Start it again.');
    }
    const handler = this.targets[intent.targetType];
    // Checked before the PIN, so an unsupported method costs no PIN attempt.
    if (!handler.methods.includes(dto.method)) {
      throw new UnprocessableEntityException(
        dto.method === PaymentMethod.WALLET
          ? 'This payment cannot be made from your wallet'
          : 'Pay this from your wallet. Add money to your wallet first if you need to.',
      );
    }

    const details = {
      ...(dto.customerReference ? { customerReference: dto.customerReference } : {}),
    };
    // Also before the PIN: a mistyped number is not a reason to lose an attempt.
    await handler.verifyConfirmation?.(this.prisma, userId, intent.targetId, details);

    await this.pins.verifyPin(userId, dto.transactionPin);

    return settlesSynchronously(dto.method)
      ? this.settleFromWallet(userId, intentId, idempotencyKey, handler, details)
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
    handler: PaymentTarget,
    details: ConfirmationDetails,
  ): Promise<PaymentIntentView> {
    const completesLater = typeof handler.afterCommit === 'function';
    let settledPayment: SettledPayment | null = null;
    const settled = await this.transactions.serializable(async (tx) => {
      const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, userId } });
      if (!intent) throw new NotFoundException('Payment was not found');
      if (intent.status !== PaymentIntentStatus.REQUIRES_CONFIRMATION) return intent;
      if (!intent.walletId) {
        throw new UnprocessableEntityException('No wallet is available for this currency');
      }

      // Re-resolved inside the transaction: the amount is only trustworthy if
      // the target still says so at the moment money moves.
      const target = await handler.resolve(
        tx,
        userId,
        intent.targetId,
        this.storedRequest(handler, intent.amountMinor),
      );
      if (target.amountMinor !== intent.amountMinor) {
        throw new ConflictException('The amount changed. Start this payment again.');
      }

      const accounts = await this.accounts(tx, intent.walletId, intent.currency);
      const destination = await handler.creditAccount(tx, intent.targetId, intent.currency);
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
            accountId: destination.id,
            direction: 'CREDIT',
            // A target that may still fail holds the fee with the amount, so
            // both can be returned; see PaymentTarget.holdsFee.
            amountMinor: handler.holdsFee ? intent.totalMinor : intent.amountMinor,
          },
          // Only present when a fee is actually charged, so a zero-fee target
          // does not put an empty row in the ledger.
          ...(intent.feeMinor > 0n && !handler.holdsFee
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

      settledPayment = {
        userId,
        targetId: intent.targetId,
        intentId: intent.id,
        amountMinor: intent.amountMinor,
        feeMinor: intent.feeMinor,
        currency: intent.currency,
        ledgerTransactionId: posting.id,
      };
      await handler.settle(tx, settledPayment);

      return tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          // A target finished after commit is not done yet: it is PROCESSING
          // until afterCommit reports what the provider said.
          status: completesLater ? PaymentIntentStatus.PROCESSING : PaymentIntentStatus.SUCCEEDED,
          method: PaymentMethod.WALLET,
          ledgerTransactionId: posting.id,
          confirmedAt: new Date(),
          ...(completesLater ? {} : { settledAt: new Date() }),
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

    if (completesLater && settledPayment && handler.afterCommit) {
      // Outside the transaction: this calls a provider. The target records the
      // outcome on the intent itself, so a crash here leaves it PROCESSING and
      // reconciliation, not this request, finishes it.
      await handler.afterCommit(settledPayment, details).catch(() => 'PROCESSING' as const);
      const finished = await this.prisma.paymentIntent.findUniqueOrThrow({
        where: { id: settled.id },
      });
      return this.view(finished, await this.describe(finished));
    }

    return this.view(settled, await this.describe(settled));
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
    const handler = this.targets[intent.targetType];
    const target = await handler.resolve(
      this.prisma,
      userId,
      intent.targetId,
      this.storedRequest(handler, intent.amountMinor),
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
    return this.view(intent, await this.describe(intent));
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
   * What to pass a target as the requested amount when re-resolving a stored
   * intent: the amount already quoted, for a target whose payer chose it, and
   * nothing for a fixed one, which must still read the same from its row.
   */
  private storedRequest(handler: PaymentTarget, amountMinor: bigint): bigint | null {
    return handler.amountRule === 'fixed' ? null : amountMinor;
  }

  /** A label for an intent's target, which may since have been paid or removed. */
  private describe(intent: {
    targetType: PaymentTargetType;
    targetId: string | null;
  }): Promise<string> {
    return this.targets[intent.targetType].describe(this.prisma, intent.targetId);
  }

  /**
   * The payer's side of a wallet payment: the wallet it leaves, and where a fee
   * goes. Where the money arrives is the target's to say (`creditAccount`).
   */
  private async accounts(tx: TransactionClient, walletId: string, currency: string) {
    const [available, feeRevenue] = await Promise.all([
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
          purpose: FinancialAccountPurpose.PLATFORM_FEE_REVENUE,
          currency,
          isActive: true,
        },
      }),
    ]);
    if (!available || !feeRevenue) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return { available, feeRevenue };
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
      methods: this.targets[intent.targetType].methods,
      description,
      expiresAt: intent.expiresAt.toISOString(),
      settledAt: intent.settledAt?.toISOString() ?? null,
      failureReason: intent.failureReason,
    };
  }
}
