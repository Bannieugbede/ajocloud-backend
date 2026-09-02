import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

/**
 * Withdrawals leave the platform through a bank rail we do not yet operate, so
 * they stop at PENDING for an operator to release. Sending between wallets does
 * not: it is a movement inside our own ledger and settles immediately.
 */
export const WITHDRAWAL_REQUIRES_REVIEW = true;

/** A movement must be a positive whole number of minor units. */
export function assertPayableAmount(amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new UnprocessableEntityException('Amount must be greater than zero');
  }
}

/**
 * Checks a wallet can cover a movement.
 *
 * Compares against the available balance only. Reserved funds are already
 * committed to something else — a bill payment awaiting its provider, say — so
 * spending them twice is exactly what reserving them prevents.
 */
export function assertSufficientFunds(availableMinor: bigint, totalMinor: bigint): void {
  if (availableMinor < totalMinor) {
    throw new UnprocessableEntityException('Your wallet balance is not enough');
  }
}

/** Sending to yourself would post a debit and credit to the same account. */
export function assertDifferentWallets(sourceWalletId: string, destinationWalletId: string): void {
  if (sourceWalletId === destinationWalletId) {
    throw new UnprocessableEntityException('Choose a different wallet to send to');
  }
}

/** Both sides of a transfer must be spendable. */
export function assertWalletActive(status: string, label: string): void {
  if (status !== 'ACTIVE') {
    throw new ConflictException(`The ${label} wallet is not active`);
  }
}

/** Money only moves between accounts holding the same currency. */
export function assertSameCurrency(source: string, destination: string): void {
  if (source !== destination) {
    throw new UnprocessableEntityException('Both wallets must hold the same currency');
  }
}
