# Financial ledger

The ledger is append-only double entry. Every posting contains at least two positive integer-minor-unit entries in one currency, and total debits must exactly equal credits. `LedgerService` validates before opening a serializable transaction, uses a unique idempotency key/reference, and posts entries atomically.

Posted entries are immutable by policy. Corrections create a new transaction with opposite directions and mark the original reversed; they never edit historical amounts. Wallet balances are calculated from posted entries for explicit available and reserved wallet accounts. Registration creates those wallet accounts; deployment/seed configuration owns platform provider-payable and fee-revenue accounts. Broader chart-of-account governance remains Phase 2 work.

External calls occur before or after database boundaries, never inside them. Provider confirmation must be persisted, verified, idempotently translated to ledger commands, and reconciled independently.

Bill Payment uses a pending/reserved wallet liability before dispatch. Success converts the reserve into provider payable and fee/revenue postings; confirmed failure releases it; timeout or unknown outcome retains it until inquiry/reconciliation. Reversal and refund are new immutable postings. Flexible Ajo locks only when deterministic integer-unit inflows and outflows reconcile exactly; Ajo Cloud supplies no float.
