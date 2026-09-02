import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FinancialAccountPurpose,
  TransferStatus,
  WithdrawalStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TransactionPinService } from '../auth/transaction-pin.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  assertDifferentWallets,
  assertPayableAmount,
  assertSameCurrency,
  assertSufficientFunds,
  assertWalletActive,
} from './domain/wallet-policy.js';
import type { SendToWalletDto, WithdrawDto } from './dto/wallet-movement.dto.js';

@Injectable()
export class WalletMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
    private readonly pins: TransactionPinService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Moves money from the caller's wallet to another member's.
   *
   * Settles inside one serializable transaction: the balance check and both
   * ledger legs have to be atomic, or two concurrent sends could each pass a
   * check against the same funds.
   */
  async send(userId: string, dto: SendToWalletDto, idempotencyKey: string): Promise<unknown> {
    const amountMinor = BigInt(dto.amountMinor);
    assertPayableAmount(amountMinor);

    // Verified before the transaction opens, so a wrong PIN neither holds a
    // serializable lock nor consumes the idempotency key.
    await this.pins.verifyPin(userId, dto.transactionPin);

    const existing = await this.prisma.transfer.findUnique({ where: { idempotencyKey } });
    // A retried tap returns the original transfer rather than sending twice.
    if (existing) return this.view(existing);

    const settled = await this.withIdempotencyRace(
      () => this.prisma.transfer.findUnique({ where: { idempotencyKey } }),
      () =>
        this.transactions.serializable(async (tx) => {
          const again = await tx.transfer.findUnique({ where: { idempotencyKey } });
          if (again) return again;

          const source = await tx.wallet.findFirst({
            where: { id: dto.sourceWalletId, userId },
            select: { id: true, currency: true, status: true },
          });
          if (!source) throw new NotFoundException('Wallet was not found');

          const recipient = await tx.user.findUnique({
            where: { email: dto.recipientEmail.trim().toLowerCase() },
            select: { id: true },
          });
          // Deliberately the same message as a missing wallet: a distinct one would
          // let anyone test whether an email has an account here.
          if (!recipient) throw new NotFoundException('That person could not be found');
          const destination = await tx.wallet.findFirst({
            where: { userId: recipient.id, currency: source.currency },
            select: { id: true, currency: true, status: true },
          });
          if (!destination) throw new NotFoundException('That person could not be found');

          assertDifferentWallets(source.id, destination.id);
          assertWalletActive(source.status, 'source');
          assertWalletActive(destination.status, 'destination');
          assertSameCurrency(source.currency, destination.currency);

          const from = await this.availableAccount(tx, source.id, source.currency);
          const to = await this.availableAccount(tx, destination.id, destination.currency);
          const balance = await this.ledger.accountBalanceWithin(tx, from.id);
          assertSufficientFunds(balance, amountMinor);

          const internalReference = `SEND-${randomUUID()}`;
          const posting = await this.ledger.postWithin(tx, {
            idempotencyKey: `transfer:${idempotencyKey}`,
            reference: internalReference,
            description: dto.note?.trim() ? `Sent: ${dto.note.trim()}` : 'Sent to another wallet',
            currency: source.currency,
            initiatedByUserId: userId,
            entries: [
              { accountId: from.id, direction: 'DEBIT', amountMinor },
              { accountId: to.id, direction: 'CREDIT', amountMinor },
            ],
          });

          return tx.transfer.create({
            data: {
              sourceWalletId: source.id,
              destinationWalletId: destination.id,
              internalReference,
              amountMinor,
              currency: source.currency,
              status: TransferStatus.SUCCEEDED,
              idempotencyKey,
              ledgerTransactionId: posting.id,
            },
          });
        }),
    );

    await this.audit.record({
      actorUserId: userId,
      action: 'wallet.transfer.sent',
      subjectType: 'Transfer',
      subjectId: settled.id,
      metadata: { amountMinor: settled.amountMinor.toString(), currency: settled.currency },
    });
    return this.view(settled);
  }

  /**
   * Requests a payout to a linked bank account.
   *
   * The funds are reserved, not sent: the money leaves through a bank rail we
   * do not operate yet, so the request stops at PENDING for an operator to
   * release. Reserving now is what stops the same balance being spent twice
   * while the payout is outstanding.
   */
  async withdraw(userId: string, dto: WithdrawDto, idempotencyKey: string): Promise<unknown> {
    const amountMinor = BigInt(dto.amountMinor);
    assertPayableAmount(amountMinor);
    await this.pins.verifyPin(userId, dto.transactionPin);

    const existing = await this.prisma.withdrawal.findUnique({ where: { idempotencyKey } });
    if (existing) return this.view(existing);

    const created = await this.withIdempotencyRace(
      () => this.prisma.withdrawal.findUnique({ where: { idempotencyKey } }),
      () =>
        this.transactions.serializable(async (tx) => {
          const again = await tx.withdrawal.findUnique({ where: { idempotencyKey } });
          if (again) return again;

          const wallet = await tx.wallet.findFirst({
            where: { id: dto.walletId, userId },
            select: { id: true, currency: true, status: true },
          });
          if (!wallet) throw new NotFoundException('Wallet was not found');
          assertWalletActive(wallet.status, 'source');

          // Scoped to the caller: paying out to someone else's linked account is
          // exactly what this check exists to prevent.
          const account = await tx.linkedBankAccount.findFirst({
            where: { id: dto.bankAccountId, userId },
            select: { id: true, accountMasked: true, bankName: true },
          });
          if (!account) throw new NotFoundException('Bank account was not found');

          const available = await this.availableAccount(tx, wallet.id, wallet.currency);
          const reserved = await this.reservedAccount(tx, wallet.id, wallet.currency);
          const balance = await this.ledger.accountBalanceWithin(tx, available.id);
          assertSufficientFunds(balance, amountMinor);

          const internalReference = `WDL-${randomUUID()}`;
          const posting = await this.ledger.postWithin(tx, {
            idempotencyKey: `withdrawal-reserve:${idempotencyKey}`,
            reference: internalReference,
            description: `Reserved for payout to ${account.bankName} ${account.accountMasked}`,
            currency: wallet.currency,
            initiatedByUserId: userId,
            entries: [
              { accountId: available.id, direction: 'DEBIT', amountMinor },
              { accountId: reserved.id, direction: 'CREDIT', amountMinor },
            ],
          });

          return tx.withdrawal.create({
            data: {
              userId,
              walletId: wallet.id,
              internalReference,
              amountMinor,
              currency: wallet.currency,
              status: WithdrawalStatus.PENDING,
              idempotencyKey,
              ledgerTransactionId: posting.id,
            },
          });
        }),
    );

    await this.audit.record({
      actorUserId: userId,
      action: 'wallet.withdrawal.requested',
      subjectType: 'Withdrawal',
      subjectId: created.id,
      metadata: { amountMinor: created.amountMinor.toString(), currency: created.currency },
    });
    return this.view(created);
  }

  /** The caller's own transfers and withdrawals, newest first. */
  async movements(userId: string): Promise<unknown> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const [transfers, withdrawals] = await Promise.all([
      this.prisma.transfer.findMany({
        where: {
          OR: [{ sourceWalletId: { in: walletIds } }, { destinationWalletId: { in: walletIds } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      this.prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);
    return {
      transfers: transfers.map((transfer) => ({
        ...this.view(transfer),
        // Tells the screen which way the money went without exposing the other
        // party's wallet id.
        direction: walletIds.includes(transfer.sourceWalletId) ? 'OUT' : 'IN',
      })),
      withdrawals: withdrawals.map((withdrawal) => this.view(withdrawal)),
    };
  }

  /**
   * Runs a settlement, returning the winner's record if this request lost an
   * idempotency race.
   *
   * Two taps with the same key can pass their in-transaction check
   * simultaneously; the database's unique constraint then rejects the loser.
   * That rejection means the work was done by the other request, so the record
   * is re-read rather than surfaced as a failure - a double tap on a flaky
   * connection must not look like an error.
   */
  private async withIdempotencyRace<T>(
    read: () => Promise<T | null>,
    settle: () => Promise<T>,
  ): Promise<T> {
    try {
      return await settle();
    } catch (error) {
      const winner = await read();
      if (winner) return winner;
      throw error;
    }
  }

  private async availableAccount(tx: TransactionClient, walletId: string, currency: string) {
    return this.account(tx, walletId, currency, FinancialAccountPurpose.WALLET_AVAILABLE);
  }

  private async reservedAccount(tx: TransactionClient, walletId: string, currency: string) {
    return this.account(tx, walletId, currency, FinancialAccountPurpose.WALLET_RESERVED);
  }

  private async account(
    tx: TransactionClient,
    walletId: string,
    currency: string,
    purpose: FinancialAccountPurpose,
  ) {
    const account = await tx.financialAccount.findFirst({
      where: { walletId, purpose, currency, isActive: true },
      select: { id: true },
    });
    if (!account) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return account;
  }

  /** BigInt money is serialised as strings, per the repository-wide convention. */
  private view(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? value.toString() : value,
      ]),
    );
  }
}
