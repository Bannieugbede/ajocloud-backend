import { UnprocessableEntityException } from '@nestjs/common';
import type { LedgerPostingCommand } from './ledger.types.js';

export function assertBalancedPosting(command: LedgerPostingCommand): void {
  if (command.entries.length < 2) {
    throw new UnprocessableEntityException('A ledger posting requires at least two entries');
  }
  if (!/^[A-Z]{3}$/.test(command.currency)) {
    throw new UnprocessableEntityException('Currency must be a three-letter uppercase code');
  }

  let debits = 0n;
  let credits = 0n;
  for (const entry of command.entries) {
    if (entry.amountMinor <= 0n) {
      throw new UnprocessableEntityException('Ledger entry amounts must be positive');
    }
    if (entry.direction === 'DEBIT') debits += entry.amountMinor;
    else credits += entry.amountMinor;
  }
  if (debits !== credits) {
    throw new UnprocessableEntityException('Ledger transaction is not balanced');
  }
}
