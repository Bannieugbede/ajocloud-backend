import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AkawoDueStatus,
  FinancialAccountPurpose,
  PaymentMethod,
  PaymentTargetType,
} from '../../../../generated/prisma/enums.js';
import type { TransactionClient } from '../../../infrastructure/database/transaction.service.js';
import { assertOrganiserVerified } from '../../kyc/kyc-facts.js';
import type {
  PaymentTarget,
  PaymentTargetClient,
  ResolvedTarget,
  SettledPayment,
} from './payment-target.js';

/**
 * One member's due in an Akawo pool.
 *
 * This is the only path by which a due may reach PAID, which is what ADR-007
 * requires: the pool module contains no route that writes it.
 */
@Injectable()
export class AkawoPoolDueTarget implements PaymentTarget {
  readonly type = PaymentTargetType.AKAWO_POOL_DUE;
  readonly methods = [PaymentMethod.WALLET] as const;
  readonly amountRule = 'fixed' as const;

  async resolve(
    client: PaymentTargetClient,
    userId: string,
    targetId: string | null,
  ): Promise<ResolvedTarget> {
    if (!targetId) throw new NotFoundException('This payment was not found');
    const due = await client.akawoPoolDue.findUnique({
      where: { id: targetId },
      include: {
        pool: { select: { name: true, organiserUserId: true } },
        member: { select: { userId: true } },
      },
    });
    // Scoped to the member who owes it: one member must not be able to pay, or
    // probe the amount of, another's due.
    if (!due || due.member.userId !== userId) {
      throw new NotFoundException('This payment was not found');
    }
    if (due.status !== AkawoDueStatus.PENDING) {
      throw new ConflictException('This has already been settled');
    }
    // The organiser receives this money, so they must be fully verified.
    await assertOrganiserVerified(client, due.pool.organiserUserId);
    return {
      amountMinor: due.amountMinor,
      currency: due.currency,
      description: `Akawo pool: ${due.pool.name}`,
    };
  }

  /**
   * Provider-payable: money leaving a wallet for a pool is held there until the
   * organiser is paid, so it is never simply removed from the books.
   */
  async creditAccount(tx: TransactionClient, _targetId: string | null, currency: string) {
    const account = await tx.financialAccount.findFirst({
      where: {
        walletId: null,
        purpose: FinancialAccountPurpose.PROVIDER_PAYABLE,
        currency,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return account;
  }

  async settle(tx: TransactionClient, payment: SettledPayment): Promise<void> {
    if (!payment.targetId) return;
    await tx.akawoPoolDue.update({
      where: { id: payment.targetId },
      data: {
        status: AkawoDueStatus.PAID,
        ledgerTransactionId: payment.ledgerTransactionId,
        paidAt: new Date(),
      },
    });
  }

  async describe(client: PaymentTargetClient, targetId: string | null): Promise<string> {
    const due = targetId
      ? await client.akawoPoolDue
          .findUnique({ where: { id: targetId }, select: { pool: { select: { name: true } } } })
          .catch(() => null)
      : null;
    return due ? `Akawo pool: ${due.pool.name}` : 'Akawo pool payment';
  }
}
