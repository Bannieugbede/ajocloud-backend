# Financial ledger

The ledger is append-only double entry. Every posting contains at least two positive integer-minor-unit entries in one currency, and total debits must exactly equal credits. `LedgerService` validates before opening a serializable transaction, uses a unique idempotency key/reference, and posts entries atomically.

Posted entries are immutable by policy. Corrections create a new transaction with opposite directions and mark the original reversed; they never edit historical amounts. Wallet balances must be calculated from posted entries for the wallet's accounts. Pending/reserved account design and production chart-of-account ownership remain Phase 2 work.

External calls occur before or after database boundaries, never inside them. Provider confirmation must be persisted, verified, idempotently translated to ledger commands, and reconciled independently.
