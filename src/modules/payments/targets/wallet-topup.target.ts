import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  FinancialAccountPurpose,
  PaymentMethod,
  PaymentTargetType,
} from '../../../../generated/prisma/enums.js';
import type { TransactionClient } from '../../../infrastructure/database/transaction.service.js';
import { MINIMUM_DEPOSIT_MINOR } from '../domain/payment-policy.js';
import type { PaymentTarget, PaymentTargetClient, ResolvedTarget } from './payment-target.js';

/**
 * Money brought into the member's own wallet from outside.
 *
 * The one target with no row to read an amount from, so the payer names it.
 * Settled only by a verified provider webhook (ADR-010), never within a
 * request, which is why the wallet is not among its methods: paying a top-up
 * from the wallet being topped up would move money out of it, not in.
 */
@Injectable()
export class WalletTopUpTarget implements PaymentTarget {
  readonly type = PaymentTargetType.WALLET_TOPUP;
  readonly methods = [PaymentMethod.TRANSFER, PaymentMethod.CARD] as const;
  readonly amountRule = 'chosen' as const;
  /** Money arriving from outside carries the deposit fee (ADR-009). */
  readonly feeCode = 'DEPOSIT' as const;

  async resolve(
    client: PaymentTargetClient,
    userId: string,
    _targetId: string | null,
    requestedAmountMinor: bigint | null,
  ): Promise<ResolvedTarget> {
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

  /**
   * Unreachable while the wallet is not an accepted method; kept correct
   * rather than throwing so the contract holds for every target.
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

  /** The deposit itself is the credit; `PaymentSettlementService` posts it. */
  settle(): Promise<void> {
    return Promise.resolve();
  }

  describe(): Promise<string> {
    return Promise.resolve('Wallet top-up');
  }
}
