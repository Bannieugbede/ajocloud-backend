# ADR-008 — Shared payment intents

- Status: Accepted
- Date: 2026-09-02
- Builds on [ADR-005](ADR-005-monnify-as-single-financial-and-identity-provider.md)
  (Monnify as the single financial provider) and
  [ADR-007](ADR-007-akawo-group-pools.md) (a pool due reaches `PAID` only through
  settled ledger movement).

## Context

Four products need to take money: Akawo pool dues, Ajo contributions, Food
subscriptions, and plain wallet top-ups. Nothing on the backend moved money for
any of them — wallets were read-only.

The mobile client was built first, against a documented contract, with one
shared payment flow that every feature hands off to. That constrains this
decision usefully: whatever is built must serve all four targets through one
route, because the client already assumes exactly that.

The obvious alternative — a pay endpoint per product — was rejected. Each one
would re-implement amount resolution, idempotency, PIN verification, balance
checks, and ledger posting. Those are the parts where a mistake loses money, and
four copies means four chances to get one wrong, plus four places to fix it.

## Decision

### 1. One intent aggregate, targets as a discriminated column pair

`PaymentIntent` carries `targetType` (an enum) plus `targetId`, not a foreign key
per product. A nullable FK per product would add a column and a constraint for
every new payable thing, and would still not express "exactly one of these is
set" without a check constraint per combination.

The cost is that `targetId` is not referentially enforced by the database. That
is accepted because the target is resolved and authorised inside the same
serializable transaction that posts the ledger entries, so an intent cannot
settle against a target that does not exist or is not the payer's to pay.

### 2. The amount is resolved server-side, always

The client sends only what it is paying for, never how much. `resolveTarget`
reads the amount from the target row — the pool due, the Ajo schedule — and the
request body has no amount field at all, so there is nothing to tamper with and
nothing to validate against.

This is the single most important rule here. A client-supplied amount on a
payment route is an underpayment vulnerability: a member could settle a ₦50,000
due for ₦1 and the due would still transition to `PAID`.

### 3. `feeMinor` is zero until the fee model is settled

`docs/open-questions/platform-fee-model.md` records that the banded fee model
cannot yet be computed: the band boundaries are ambiguous at every threshold
("up to ₦10,000" then "from ₦10,000" overlap at exactly ₦10,000), and an
off-by-one at a band edge is a money bug that surfaces only in reconciliation.

Rather than block the entire payment path on that, `feeMinor` is persisted and
returned as an explicit `0`, and the ledger posting only credits fee revenue when
it is non-zero. The column, the API field, and the fee-revenue leg all exist and
are exercised; only the calculation is pending. When the model is decided, the
change is confined to one function.

This is deliberately visible rather than hidden: the response says the fee is
zero, so nobody can mistake an unimplemented fee for a free product.

### 4. Wallet payments settle synchronously; external rails do not

A `WALLET` payment debits available and credits the target's destination in one
serializable transaction, and the intent is `SUCCEEDED` when that returns. There
is no provider round-trip, so there is nothing to await.

`TRANSFER` and `CARD` move to `PROCESSING` and stay there. Settlement for those
arrives on a Monnify webhook, which ADR-006 already established as the only
trusted source of external payment truth. They are wired to return provider
instructions but cannot complete until Monnify credentials are configured; the
provider port has a mock implementation so the flow is testable without them.

### 5. Confirmation requires the transaction PIN, and PIN failure must not consume the intent

`confirm` verifies the PIN through the existing `TransactionPinService`, which
already enforces a lockout after five consecutive failures.

The PIN is checked **before** the intent transitions out of `REQUIRES_CONFIRMATION`.
A wrong PIN therefore leaves the intent reusable, so a mistyped digit does not
force the user to start the payment again. Only a PIN that verifies moves the
intent forward.

### 6. Idempotency is scoped per user and keyed by the caller

Both `create` and `confirm` require an `Idempotency-Key`. A retried tap on a
flaky connection must not produce a second payment.

Rather than the shared `IdempotencyService` — which throws on a repeat and so
cannot return the original result — these routes store the key on the intent
itself, unique per `(userId, idempotencyKey)`. A repeat returns the existing
intent, which is what a retrying client needs: the same answer, not an error.

The uniqueness is enforced by a database constraint, not by a read-then-write,
so two concurrent taps cannot both pass the check.

## Consequences

- Adding a payable product means adding one enum value and one `resolveTarget`
  branch. It does not mean a new route, and it cannot mean a second copy of the
  settlement logic.
- `targetId` integrity is enforced in application code inside the settlement
  transaction rather than by the database. That is a real trade-off and is the
  main cost of the discriminated-target design.
- Until the fee model lands, every payment is fee-free. This is recorded in the
  API response rather than left implicit.
- Transfer and card payments cannot complete end to end until Monnify
  credentials exist. Wallet payments are fully functional today.
