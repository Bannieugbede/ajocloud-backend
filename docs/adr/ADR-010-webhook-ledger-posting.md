# ADR-010: Ledger posting for settlement webhooks

- Status: Accepted
- Date: 2026-09-03
- Depends on ADR-006 (only a verified webhook completes an external payment) and ADR-009 (fees).

## Context

`MonnifyWebhooksService` records events durably and returns 200 quickly, but posts nothing to the
ledger. Every external payment therefore reaches `PROCESSING` and stays there: a bank transfer that
genuinely succeeded never credits the wallet it paid for. Money cannot enter the platform at all,
which is why development balances are seeded rather than deposited.

What was missing was not the handler but the account mapping — which accounts move, in which
direction, and where the fee sits — and that is a decision, not an implementation detail.

## Decision

### A successful deposit posts three legs

For a deposit of `amount` carrying a platform fee of `fee` (ADR-009), on a verified
`SUCCESSFUL_TRANSACTION` event:

| Account                | Direction | Amount         |
| ---------------------- | --------- | -------------- |
| `PROVIDER_PAYABLE`     | DEBIT     | `amount`       |
| `WALLET_AVAILABLE`     | CREDIT    | `amount - fee` |
| `PLATFORM_FEE_REVENUE` | CREDIT    | `fee`          |

The provider account is debited by the gross, because that is what the provider actually holds on
the platform's behalf. **The fee is netted from the credit rather than charged separately**: the
user sent one amount and the platform never has a second opportunity to collect, so a fee charged
as its own debit could fail against an empty wallet and leave the ledger describing a fee that was
never taken. Netting also means the credited figure is exactly what the user sees as their balance.

When the fee is zero the third leg is omitted rather than posted as zero, so no empty rows enter the
ledger.

### The webhook posts; it does not decide

The handler resolves the intent by `providerReference`, checks it is still `PROCESSING`, and posts.
It does not recompute the fee: `PaymentIntent.feeMinor` was fixed when the intent was created and is
what the user was shown. Re-deriving it at settlement could charge a different amount from the one
quoted, if a definition version changed in between.

An event whose `providerReference` matches no intent is recorded and acknowledged, never guessed at.
Unmatched settlements belong to reconciliation, which already has `ReconciliationRecord`.

### Exactly-once is enforced twice

`PaymentWebhookEvent` is unique on `(provider, providerEventId)`, so a redelivery is a no-op. The
ledger posting additionally carries an idempotency key derived from the intent, so even a
same-payment event arriving under a new provider event id cannot post twice. Two independent
guards, because a duplicate credit is unrecoverable once a user has spent it.

### Processing is deferred, not inline

The event row is written and 200 returned before any posting runs, per the existing design: a
handler that makes the provider wait turns one event into a retry storm. Posting happens in the same
request only after acknowledgement is guaranteed, and a posting failure leaves the event row
`PENDING` for retry rather than failing the acknowledgement.

### Failed and reversed events

A `FAILED` event moves the intent to `FAILED` with the provider's reason and posts nothing — no
money moved. Reversals are explicitly **out of scope**: ADR-009 leaves fee refundability undecided,
and a reversal that silently kept its fee, or silently refunded it, would both be wrong. Until that
is settled a reversal event is recorded and left for manual reconciliation rather than posted.

## Consequences

Money can enter the platform. Wallet top-ups complete end to end, and the seeded opening balances
become a development convenience rather than the only way a wallet is ever funded.

The platform now earns: the fee leg is real, and `PLATFORM_FEE_REVENUE` accumulates against actual
deposits.

Still outstanding: payout execution debits `PROVIDER_PAYABLE` in the other direction and is a
separate workflow; and reversal handling stays blocked on the refundability question in ADR-009.
