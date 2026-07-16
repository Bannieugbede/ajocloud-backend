import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerEntryDirection, LedgerTransactionStatus } from '../../../generated/prisma/enums.js';
import { TransactionService } from '../../infrastructure/database/transaction.service.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import { assertBalancedPosting } from './domain/ledger-invariants.js';
import type { LedgerPostingCommand } from './domain/ledger.types.js';

@Injectable()
export class LedgerService {
  constructor(private readonly transactions: TransactionService) {}

  async post(command: LedgerPostingCommand): Promise<{ id: string; reference: string }> {
    assertBalancedPosting(command);
    return this.transactions.serializable((tx) => this.postWithin(tx, command));
  }

  async postWithin(
    tx: TransactionClient,
    command: LedgerPostingCommand,
  ): Promise<{ id: string; reference: string }> {
    assertBalancedPosting(command);
    const existing = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) return { id: existing.id, reference: existing.reference };

    const transaction = await tx.ledgerTransaction.create({
      data: {
        idempotencyKey: command.idempotencyKey,
        reference: command.reference,
        description: command.description,
        currency: command.currency,
        status: LedgerTransactionStatus.POSTED,
        postedAt: new Date(),
        ...(command.initiatedByUserId ? { initiatedByUserId: command.initiatedByUserId } : {}),
        ...(command.correlationId ? { correlationId: command.correlationId } : {}),
        entries: {
          create: command.entries.map((entry, index) => ({
            accountId: entry.accountId,
            direction:
              entry.direction === 'DEBIT'
                ? LedgerEntryDirection.DEBIT
                : LedgerEntryDirection.CREDIT,
            amountMinor: entry.amountMinor,
            currency: command.currency,
            sequence: index + 1,
          })),
        },
      },
    });
    return { id: transaction.id, reference: transaction.reference };
  }

  async accountBalanceWithin(tx: TransactionClient, accountId: string): Promise<bigint> {
    const entries = await tx.ledgerEntry.findMany({
      where: { accountId, transaction: { status: LedgerTransactionStatus.POSTED } },
      select: { direction: true, amountMinor: true },
    });
    return entries.reduce(
      (balance, entry) =>
        entry.direction === LedgerEntryDirection.CREDIT
          ? balance + entry.amountMinor
          : balance - entry.amountMinor,
      0n,
    );
  }

  async reverse(
    originalId: string,
    idempotencyKey: string,
    reference: string,
  ): Promise<{ id: string; reference: string }> {
    return this.transactions.serializable(async (tx) => {
      const original = await tx.ledgerTransaction.findUnique({
        where: { id: originalId },
        include: { entries: { orderBy: { sequence: 'asc' } } },
      });
      if (!original || original.status !== LedgerTransactionStatus.POSTED) {
        throw new NotFoundException('Posted ledger transaction was not found');
      }
      const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return { id: existing.id, reference: existing.reference };

      const reversal = await tx.ledgerTransaction.create({
        data: {
          reference,
          idempotencyKey,
          description: `Reversal of ${original.reference}`,
          currency: original.currency,
          status: LedgerTransactionStatus.POSTED,
          reversalOfId: original.id,
          postedAt: new Date(),
          entries: {
            create: original.entries.map((entry, index) => ({
              accountId: entry.accountId,
              direction:
                entry.direction === LedgerEntryDirection.DEBIT
                  ? LedgerEntryDirection.CREDIT
                  : LedgerEntryDirection.DEBIT,
              amountMinor: entry.amountMinor,
              currency: entry.currency,
              sequence: index + 1,
            })),
          },
        },
      });
      await tx.ledgerTransaction.update({
        where: { id: original.id },
        data: { status: LedgerTransactionStatus.REVERSED, reversedAt: new Date() },
      });
      return { id: reversal.id, reference: reversal.reference };
    });
  }
}
