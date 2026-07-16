export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface LedgerPostingEntry {
  readonly accountId: string;
  readonly direction: EntryDirection;
  readonly amountMinor: bigint;
}

export interface LedgerPostingCommand {
  readonly idempotencyKey: string;
  readonly reference: string;
  readonly description: string;
  readonly currency: string;
  readonly initiatedByUserId?: string;
  readonly correlationId?: string;
  readonly entries: readonly LedgerPostingEntry[];
}
