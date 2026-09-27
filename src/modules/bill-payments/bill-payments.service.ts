import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import {
  BillPaymentAttemptStatus,
  BillPaymentStatus,
  FinancialAccountPurpose,
  ReconciliationState,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Environment } from '../../config/env.schema.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { assessVersionedFee } from '../fees/domain/fee-rule.js';
import type { CreateBillPaymentDto } from './dto/create-bill-payment.dto.js';
import type { ValidateBillCustomerDto } from './dto/validate-bill-customer.dto.js';
import { syncBillCatalog } from './bill-catalog-sync.js';
import {
  BILL_REFERENCE_KINDS,
  billReferenceProblem,
  defaultReferenceLabel,
  normaliseBillReference,
  type BillReferenceKind,
} from './domain/bill-reference.js';
import {
  BILL_PAYMENT_PROVIDER,
  type BillPaymentProvider,
  type ProviderBillPayment,
} from './providers/bill-payment-provider.js';

@Injectable()
export class BillPaymentsService {
  private readonly referencePepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
    @Inject(BILL_PAYMENT_PROVIDER) private readonly provider: BillPaymentProvider,
    config: ConfigService<Environment, true>,
  ) {
    this.referencePepper = config.get('TOKEN_PEPPER', { infer: true });
  }

  /** Categories in the order the provider lists them, which is the order shown. */
  async categories(): Promise<unknown[]> {
    await this.refreshCatalogIfNeeded();
    const categories = await this.prisma.billCategory.findMany({
      where: { provider: this.provider.name, status: 'ACTIVE' },
      select: { id: true, providerCode: true, name: true, expiresAt: true, catalogData: true },
      orderBy: { name: 'asc' },
    });
    return categories
      .sort((left, right) => positionOf(left.catalogData) - positionOf(right.catalogData))
      .map(({ id, providerCode, name, expiresAt }) => ({ id, providerCode, name, expiresAt }));
  }

  /**
   * A category's billers with their active packages. Each biller says what it
   * identifies a customer by, so the app can label and shape the field without
   * guessing from the category's name.
   */
  async billers(categoryId: string): Promise<unknown[]> {
    await this.refreshCatalogIfNeeded();
    const billers = await this.prisma.billBiller.findMany({
      where: {
        categoryId,
        category: { provider: this.provider.name, status: 'ACTIVE' },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        providerCode: true,
        name: true,
        catalogData: true,
        products: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            providerCode: true,
            name: true,
            minimumMinor: true,
            maximumMinor: true,
            fixedAmountMinor: true,
            currency: true,
            catalogData: true,
          },
          orderBy: [{ fixedAmountMinor: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: { name: 'asc' },
    });
    return billers.map(({ catalogData, products, ...biller }) => {
      const reference = referenceOf(catalogData);
      return {
        ...biller,
        referenceKind: reference.kind,
        referenceLabel: reference.label,
        products: products.map(({ catalogData: productData, ...product }) => ({
          ...product,
          validity: validityOf(productData),
        })),
      };
    });
  }

  async validateCustomer(userId: string, dto: ValidateBillCustomerDto): Promise<unknown> {
    const biller = await this.prisma.billBiller.findFirst({
      where: {
        id: dto.billerId,
        category: { provider: this.provider.name, status: 'ACTIVE' },
        status: 'ACTIVE',
      },
      include: {
        products: dto.productId ? { where: { id: dto.productId, status: 'ACTIVE' } } : false,
      },
    });
    if (!biller) throw new NotFoundException('Biller was not found');
    if (dto.productId && biller.products.length !== 1) {
      throw new NotFoundException('Biller product was not found');
    }
    const reference = referenceOf(biller.catalogData);
    const customerReference = this.normaliseReference(reference.kind, dto.customerReference);
    // Caught here rather than by the provider: a phone number one digit short
    // is the payer's typo, and the fix belongs in the message they see.
    const problem = reference.kind ? billReferenceProblem(reference.kind, customerReference) : null;
    if (problem) throw new UnprocessableEntityException(problem);
    const result = await this.provider.validateCustomer({
      billerCode: biller.providerCode,
      ...(biller.products[0] ? { productCode: biller.products[0].providerCode } : {}),
      customerReference,
    });
    const validation = await this.prisma.billCustomerValidation.create({
      data: {
        userId,
        billerId: biller.id,
        ...(dto.productId ? { productId: dto.productId } : {}),
        provider: this.provider.name,
        ...(result.providerReference ? { providerReference: result.providerReference } : {}),
        customerReferenceDigest: this.digest(customerReference),
        customerReferenceMasked: this.mask(customerReference),
        ...(result.customerName ? { verifiedCustomerName: result.customerName } : {}),
        resultSummary: { resultCode: result.resultCode },
        valid: result.valid,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: {
        id: true,
        valid: true,
        customerReferenceMasked: true,
        verifiedCustomerName: true,
        expiresAt: true,
      },
    });
    if (!result.valid) {
      throw new UnprocessableEntityException(
        `${biller.name} did not recognise this ${reference.label.toLowerCase()}. Check it and try again.`,
      );
    }
    return validation;
  }

  async create(
    userId: string,
    idempotencyKey: string,
    dto: CreateBillPaymentDto,
  ): Promise<unknown> {
    const amountMinor = BigInt(dto.amountMinor);
    const validation = await this.prisma.billCustomerValidation.findFirst({
      where: { id: dto.validationId, userId, valid: true, expiresAt: { gt: new Date() } },
    });
    const validatedBiller = validation
      ? await this.prisma.billBiller.findUnique({
          where: { id: validation.billerId },
          select: { catalogData: true },
        })
      : null;
    // Normalised exactly as validation normalised it, so "0803 123 4567" and
    // "08031234567" are one reference rather than a mismatch.
    const customerReference = this.normaliseReference(
      referenceOf(validatedBiller?.catalogData).kind,
      dto.customerReference,
    );
    const requestHash = this.digest(
      JSON.stringify({ ...dto, customerReference: this.digest(customerReference) }),
    );
    if (!validation || validation.customerReferenceDigest !== this.digest(customerReference)) {
      throw new UnprocessableEntityException('A current matching customer validation is required');
    }
    const prepared = await this.transactions.serializable(async (tx) => {
      const existing = await tx.billPayment.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key was used for a different bill payment');
        }
        return { payment: existing, existing: true } as const;
      }
      const wallet = await tx.wallet.findFirst({
        where: { id: dto.walletId, userId, status: 'ACTIVE' },
      });
      if (!wallet) throw new NotFoundException('Wallet was not found');
      const product = validation.productId
        ? await tx.billProduct.findUnique({ where: { id: validation.productId } })
        : null;
      this.assertAmount(amountMinor, wallet.currency, product);
      const fee = await tx.feeDefinition.findFirst({
        where: {
          code: 'BILL_PAYMENT',
          isActive: true,
          effectiveAt: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { version: 'desc' },
      });
      if (!fee) throw new UnprocessableEntityException('Bill Payment fee is not configured');
      const assessedFee = assessVersionedFee(fee, amountMinor);
      const feeMinor = assessedFee.amountMinor;
      const totalDebitMinor = amountMinor + feeMinor;
      const accounts = await this.accounts(tx, wallet.id, wallet.currency);
      const available = await this.ledger.accountBalanceWithin(tx, accounts.available.id);
      if (available < totalDebitMinor)
        throw new UnprocessableEntityException('Insufficient wallet funds');
      const internalReference = `BILL-${randomUUID()}`;
      const payment = await tx.billPayment.create({
        data: {
          internalReference,
          provider: this.provider.name,
          idempotencyKey,
          requestHash,
          userId,
          walletId: wallet.id,
          billerId: validation.billerId,
          ...(validation.productId ? { productId: validation.productId } : {}),
          validationId: validation.id,
          customerReferenceDigest: validation.customerReferenceDigest,
          customerReferenceMasked: validation.customerReferenceMasked,
          ...(validation.verifiedCustomerName
            ? { verifiedCustomerName: validation.verifiedCustomerName }
            : {}),
          amountMinor,
          feeMinor,
          totalDebitMinor,
          currency: wallet.currency,
          status: BillPaymentStatus.PENDING,
          validatedAt: new Date(),
        },
      });
      await tx.feeAssessment.create({
        data: {
          feeDefinitionId: fee.id,
          subjectType: 'BillPayment',
          subjectId: payment.id,
          amountMinor: feeMinor,
          currency: wallet.currency,
          calculationBaseMinor: amountMinor,
          ruleSnapshot: assessedFee.snapshot,
        },
      });
      const reserve = await this.ledger.postWithin(tx, {
        idempotencyKey: `bill-reserve:${payment.id}`,
        reference: `${internalReference}-RESERVE`,
        description: 'Reserve wallet funds for Bill Payment',
        currency: wallet.currency,
        initiatedByUserId: userId,
        correlationId: payment.id,
        entries: [
          { accountId: accounts.available.id, direction: 'DEBIT', amountMinor: totalDebitMinor },
          { accountId: accounts.reserved.id, direction: 'CREDIT', amountMinor: totalDebitMinor },
        ],
      });
      const updated = await tx.billPayment.update({
        where: { id: payment.id },
        data: { reserveLedgerTransactionId: reserve.id },
      });
      await tx.billPaymentAttempt.create({
        data: { billPaymentId: payment.id, attemptNumber: 1, requestHash },
      });
      await this.recordEvent(tx, userId, payment.id, 'bill-payment.reserved');
      return { payment: updated, existing: false } as const;
    });
    if (prepared.existing) return this.publicPayment(prepared.payment);

    let providerResult: ProviderBillPayment;
    try {
      const biller = await this.prisma.billBiller.findUnique({
        where: { id: prepared.payment.billerId },
      });
      const product = prepared.payment.productId
        ? await this.prisma.billProduct.findUnique({ where: { id: prepared.payment.productId } })
        : null;
      if (!biller) throw new Error('Persisted biller is missing');
      providerResult = await this.provider.createPayment({
        internalReference: prepared.payment.internalReference,
        billerCode: biller.providerCode,
        ...(product ? { productCode: product.providerCode } : {}),
        customerReference,
        amountMinor: prepared.payment.amountMinor,
        currency: prepared.payment.currency,
      });
    } catch {
      await this.markUncertain(prepared.payment.id);
      throw new BadGatewayException('Provider result is uncertain; payment is being reconciled');
    }
    return this.applyProviderResult(prepared.payment.id, userId, providerResult);
  }

  list(userId: string): Promise<unknown[]> {
    return this.prisma.billPayment.findMany({
      where: { userId },
      select: this.paymentSelect(),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(userId: string, paymentId: string): Promise<unknown> {
    const payment = await this.prisma.billPayment.findFirst({
      where: { id: paymentId, userId },
      select: this.paymentSelect(),
    });
    if (!payment) throw new NotFoundException('Bill payment was not found');
    return payment;
  }

  async reconcile(actorUserId: string, paymentId: string): Promise<unknown> {
    const payment = await this.prisma.billPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Bill payment was not found');
    if (payment.reconciliationState !== ReconciliationState.PENDING) {
      throw new ConflictException('Bill payment is not awaiting reconciliation');
    }
    let result: ProviderBillPayment;
    try {
      result = await this.provider.queryPayment(
        payment.providerReference ?? payment.internalReference,
      );
    } catch {
      throw new BadGatewayException('Provider inquiry failed; reserved funds remain held');
    }
    return this.applyProviderResult(payment.id, actorUserId, result);
  }

  private async applyProviderResult(
    paymentId: string,
    userId: string,
    result: ProviderBillPayment,
  ): Promise<unknown> {
    if (result.state === 'REVERSED') {
      return this.applyReversal(paymentId, userId, result);
    }
    if (result.state === 'PENDING' || result.state === 'UNKNOWN') {
      await this.markUncertain(paymentId, result);
      return this.get(userId, paymentId);
    }
    return this.transactions.serializable(async (tx) => {
      const payment = await tx.billPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Bill payment was not found');
      if (
        payment.status !== BillPaymentStatus.PENDING &&
        payment.status !== BillPaymentStatus.RECONCILIATION_REQUIRED
      ) {
        return this.publicPayment(payment);
      }
      const accounts = await this.accounts(tx, payment.walletId, payment.currency);
      if (result.state === 'FAILED') {
        const release = await this.ledger.postWithin(tx, {
          idempotencyKey: `bill-release:${payment.id}`,
          reference: `${payment.internalReference}-RELEASE`,
          description: 'Release Bill Payment wallet reserve',
          currency: payment.currency,
          correlationId: payment.id,
          entries: [
            {
              accountId: accounts.reserved.id,
              direction: 'DEBIT',
              amountMinor: payment.totalDebitMinor,
            },
            {
              accountId: accounts.available.id,
              direction: 'CREDIT',
              amountMinor: payment.totalDebitMinor,
            },
          ],
        });
        await tx.billPayment.update({
          where: { id: payment.id },
          data: {
            status: BillPaymentStatus.FAILED,
            ...(result.providerReference ? { providerReference: result.providerReference } : {}),
            providerStatus: result.providerStatus,
            ...(result.failureCode ? { failureCode: result.failureCode } : {}),
            failureReason: 'Provider confirmed failure',
            failedAt: new Date(),
            releaseLedgerTransactionId: release.id,
          },
        });
        await tx.billPaymentAttempt.update({
          where: { billPaymentId_attemptNumber: { billPaymentId: payment.id, attemptNumber: 1 } },
          data: { status: BillPaymentAttemptStatus.FAILED, completedAt: new Date() },
        });
        await this.recordEvent(tx, userId, payment.id, 'bill-payment.failed');
      } else {
        const posting = await this.ledger.postWithin(tx, {
          idempotencyKey: `bill-settle:${payment.id}`,
          reference: `${payment.internalReference}-SETTLE`,
          description: 'Settle successful Bill Payment',
          currency: payment.currency,
          correlationId: payment.id,
          entries: [
            {
              accountId: accounts.reserved.id,
              direction: 'DEBIT',
              amountMinor: payment.totalDebitMinor,
            },
            {
              accountId: accounts.providerPayable.id,
              direction: 'CREDIT',
              amountMinor: payment.amountMinor,
            },
            ...(payment.feeMinor > 0n
              ? [
                  {
                    accountId: accounts.feeRevenue.id,
                    direction: 'CREDIT' as const,
                    amountMinor: payment.feeMinor,
                  },
                ]
              : []),
          ],
        });
        await tx.billPayment.update({
          where: { id: payment.id },
          data: {
            status: BillPaymentStatus.SUCCESSFUL,
            ...(result.providerReference ? { providerReference: result.providerReference } : {}),
            providerStatus: result.providerStatus,
            reconciliationState: ReconciliationState.NOT_REQUIRED,
            processingAt: new Date(),
            completedAt: new Date(),
            ledgerTransactionId: posting.id,
          },
        });
        await tx.billPaymentAttempt.update({
          where: { billPaymentId_attemptNumber: { billPaymentId: payment.id, attemptNumber: 1 } },
          data: {
            status: BillPaymentAttemptStatus.CONFIRMED,
            ...(result.providerReference ? { providerReference: result.providerReference } : {}),
            completedAt: new Date(),
          },
        });
        await tx.billPaymentReceipt.create({
          data: {
            billPaymentId: payment.id,
            receiptNumber: `RCP-${payment.internalReference}`,
            snapshot: {
              reference: payment.internalReference,
              amountMinor: payment.amountMinor.toString(),
              feeMinor: payment.feeMinor.toString(),
              totalDebitMinor: payment.totalDebitMinor.toString(),
              currency: payment.currency,
              customerReference: payment.customerReferenceMasked,
            },
          },
        });
        await this.recordEvent(tx, userId, payment.id, 'bill-payment.successful');
      }
      const updated = await tx.billPayment.findUnique({ where: { id: payment.id } });
      return this.publicPayment(updated);
    });
  }

  private async applyReversal(
    paymentId: string,
    actorUserId: string,
    result: ProviderBillPayment,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const payment = await tx.billPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Bill payment was not found');
      if (payment.status === BillPaymentStatus.REVERSED) return this.publicPayment(payment);
      if (payment.status !== BillPaymentStatus.SUCCESSFUL) {
        throw new ConflictException('Only a successful Bill Payment can be reversed');
      }
      const accounts = await this.accounts(tx, payment.walletId, payment.currency);
      const posting = await this.ledger.postWithin(tx, {
        idempotencyKey: `bill-reversal:${payment.id}`,
        reference: `${payment.internalReference}-REVERSAL`,
        description: 'Reverse successful Bill Payment',
        currency: payment.currency,
        initiatedByUserId: actorUserId,
        correlationId: payment.id,
        entries: [
          {
            accountId: accounts.providerPayable.id,
            direction: 'DEBIT',
            amountMinor: payment.amountMinor,
          },
          ...(payment.feeMinor > 0n
            ? [
                {
                  accountId: accounts.feeRevenue.id,
                  direction: 'DEBIT' as const,
                  amountMinor: payment.feeMinor,
                },
              ]
            : []),
          {
            accountId: accounts.available.id,
            direction: 'CREDIT',
            amountMinor: payment.totalDebitMinor,
          },
        ],
      });
      await tx.billPaymentReversal.create({
        data: {
          billPaymentId: payment.id,
          ...(result.providerReference ? { providerReference: result.providerReference } : {}),
          amountMinor: payment.totalDebitMinor,
          currency: payment.currency,
          reason: 'Provider reported payment reversal',
          idempotencyKey: `bill-reversal:${payment.id}`,
          ledgerTransactionId: posting.id,
          completedAt: new Date(),
        },
      });
      const reversed = await tx.billPayment.update({
        where: { id: payment.id },
        data: {
          status: BillPaymentStatus.REVERSED,
          reconciliationState: ReconciliationState.RESOLVED,
          providerStatus: result.providerStatus,
          reversalLedgerTransactionId: posting.id,
          reversedAt: new Date(),
        },
      });
      await this.recordEvent(tx, actorUserId, payment.id, 'bill-payment.reversed');
      return this.publicPayment(reversed);
    });
  }

  private async markUncertain(paymentId: string, result?: ProviderBillPayment): Promise<void> {
    await this.transactions.serializable(async (tx) => {
      const payment = await tx.billPayment.update({
        where: { id: paymentId },
        data: {
          status: BillPaymentStatus.RECONCILIATION_REQUIRED,
          reconciliationState: ReconciliationState.PENDING,
          ...(result?.providerReference ? { providerReference: result.providerReference } : {}),
          ...(result ? { providerStatus: result.providerStatus } : {}),
        },
      });
      await tx.billPaymentAttempt.update({
        where: { billPaymentId_attemptNumber: { billPaymentId: paymentId, attemptNumber: 1 } },
        data: {
          status: BillPaymentAttemptStatus.UNKNOWN,
          ...(result?.providerReference ? { providerReference: result.providerReference } : {}),
          completedAt: new Date(),
        },
      });
      await this.recordEvent(
        tx,
        payment.userId,
        payment.id,
        'bill-payment.reconciliation-required',
      );
    });
  }

  /**
   * Refreshes the stored catalogue when it has expired or when the provider now
   * serves a different revision of it, so a catalogue change (a retired
   * category, a repriced package) reaches members without waiting out the
   * expiry.
   */
  private async refreshCatalogIfNeeded(): Promise<void> {
    const revision = this.provider.catalogRevision;
    const current = await this.prisma.billCategory.findFirst({
      where: {
        provider: this.provider.name,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        ...(revision ? { catalogData: { path: ['revision'], equals: revision } } : {}),
      },
      select: { id: true },
    });
    if (current) return;
    await syncBillCatalog(this.prisma, this.provider, new Date(Date.now() + 6 * 60 * 60_000));
  }

  private async accounts(tx: TransactionClient, walletId: string, currency: string) {
    const [available, reserved, providerPayable, feeRevenue] = await Promise.all([
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
          walletId,
          purpose: FinancialAccountPurpose.WALLET_RESERVED,
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
    if (!available || !reserved || !providerPayable || !feeRevenue) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return { available, reserved, providerPayable, feeRevenue };
  }

  private assertAmount(
    amountMinor: bigint,
    currency: string,
    product: {
      currency: string;
      minimumMinor: bigint | null;
      maximumMinor: bigint | null;
      fixedAmountMinor: bigint | null;
    } | null,
  ): void {
    if (amountMinor <= 0n) throw new UnprocessableEntityException('Amount must be positive');
    if (product?.currency !== undefined && product.currency !== currency) {
      throw new UnprocessableEntityException('Product and wallet currencies do not match');
    }
    if (
      product?.minimumMinor !== null &&
      product?.minimumMinor !== undefined &&
      amountMinor < product.minimumMinor
    ) {
      throw new UnprocessableEntityException('Amount is below the product minimum');
    }
    if (
      product?.maximumMinor !== null &&
      product?.maximumMinor !== undefined &&
      amountMinor > product.maximumMinor
    ) {
      throw new UnprocessableEntityException('Amount exceeds the product maximum');
    }
    if (
      product?.fixedAmountMinor !== null &&
      product?.fixedAmountMinor !== undefined &&
      amountMinor !== product.fixedAmountMinor
    ) {
      throw new UnprocessableEntityException('Amount must match the product fixed amount');
    }
  }

  private async recordEvent(
    tx: TransactionClient,
    actorUserId: string,
    paymentId: string,
    eventType: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId, action: eventType, subjectType: 'BillPayment', subjectId: paymentId },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'BillPayment',
        aggregateId: paymentId,
        eventType,
        payload: { paymentId },
      },
    });
  }

  private paymentSelect() {
    return {
      id: true,
      internalReference: true,
      providerReference: true,
      customerReferenceMasked: true,
      verifiedCustomerName: true,
      amountMinor: true,
      feeMinor: true,
      totalDebitMinor: true,
      currency: true,
      status: true,
      reconciliationState: true,
      failureReason: true,
      createdAt: true,
      completedAt: true,
      // Named so a past payment can be offered again without the caller having
      // to fetch the whole biller catalogue to learn what "••2293" was paid to.
      // Only the biller's public identity: no provider credentials or codes
      // beyond the one the pay screen already accepts.
      biller: {
        select: { id: true, name: true, category: { select: { id: true, name: true } } },
      },
      product: { select: { id: true, name: true } },
      receipt: { select: { receiptNumber: true, issuedAt: true } },
    } as const;
  }

  private publicPayment(payment: unknown): unknown {
    if (!payment || typeof payment !== 'object') return payment;
    const copy = { ...(payment as Record<string, unknown>) };
    delete copy.customerReferenceDigest;
    delete copy.requestHash;
    delete copy.metadata;
    return copy;
  }

  private normaliseReference(kind: BillReferenceKind | null, raw: string): string {
    return kind ? normaliseBillReference(kind, raw) : raw.trim();
  }

  private digest(value: string): string {
    return createHmac('sha256', this.referencePepper).update(value).digest('hex');
  }

  private mask(value: string): string {
    return value.length <= 4
      ? '*'.repeat(value.length)
      : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positionOf(catalogData: unknown): number {
  const position = record(catalogData).position;
  return typeof position === 'number' ? position : Number.MAX_SAFE_INTEGER;
}

/**
 * What a stored biller identifies its customer by. Rows written before billers
 * carried this have no kind, and are validated by the provider alone.
 */
function referenceOf(catalogData: unknown): { kind: BillReferenceKind | null; label: string } {
  const data = record(catalogData);
  const kind = BILL_REFERENCE_KINDS.find((candidate) => candidate === data.referenceKind) ?? null;
  const label =
    typeof data.referenceLabel === 'string'
      ? data.referenceLabel
      : kind
        ? defaultReferenceLabel(kind)
        : 'Customer reference';
  return { kind, label };
}

function validityOf(catalogData: unknown): string | null {
  const validity = record(catalogData).validity;
  return typeof validity === 'string' ? validity : null;
}
