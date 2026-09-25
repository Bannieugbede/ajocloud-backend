# Payments

One payment contract serves every product. Akawo pool dues, Ajo contributions,
Food subscriptions and wallet top-ups all create a **payment intent**, confirm it
with a method and the transaction PIN, and settle through the same ledger path.

The design and its trade-offs are in
[ADR-008](adr/ADR-008-shared-payment-intents.md); how each product plugs into it
is [ADR-013](adr/ADR-013-payment-targets.md).

## Routes

All require a bearer token. Money is always integer minor units serialised as
strings.

| Route                                       | Purpose                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/v1/payments/intents`             | Create an intent for a target. Requires `Idempotency-Key`. |
| `POST /api/v1/payments/intents/:id/confirm` | Confirm with a method and PIN. Requires `Idempotency-Key`. |
| `GET  /api/v1/payments/intents/:id`         | Read one intent; polled while `PROCESSING`.                |
| `GET  /api/v1/wallets/me/balance`           | Available balance, to offer or grey out the wallet method. |

## Who decides the amount

`CreateIntentDto.amountMinor` is read on exactly one line of the service, and
what happens to it is the target's `amountRule`:

| Rule      | Targets          | Meaning                                                      |
| --------- | ---------------- | ------------------------------------------------------------ |
| `fixed`   | Akawo due, Food  | Read from the row. A requested amount is refused with 422.   |
| `partial` | Ajo contribution | Up to what is still owed; nothing requested means all of it. |
| `chosen`  | Wallet top-up    | Named by the payer: there is no row to read one from.        |

The amount is re-resolved inside the settlement transaction. If the target no
longer agrees, settlement is refused rather than posting a stale figure.

This is the load-bearing rule of the module. A client-supplied amount on a fixed
target would let a member settle a ₦50,000 due for ₦1 and still have it marked
`PAID`. A part payment is safe only where the target's status is derived from
what has arrived, as an Ajo schedule's is. A source test asserts the single read
and the refusal for fixed targets, because a behavioural test would not catch a
second read added later.

## Targets

`targetType` plus `targetId`, not a foreign key per product. Each type is a
`PaymentTarget` (`src/modules/payments/targets/payment-target.ts`) registered in
`PaymentsModule`; boot fails if any type lacks one.

| Target              | `targetId`       | Methods        | Credited to                        | On settlement                         |
| ------------------- | ---------------- | -------------- | ---------------------------------- | ------------------------------------- |
| `AKAWO_POOL_DUE`    | the due          | WALLET         | provider payable                   | due → `PAID`                          |
| `AJO_CONTRIBUTION`  | the schedule     | WALLET         | the group pool                     | contribution row; schedule rebalanced |
| `FOOD_SUBSCRIPTION` | the subscription | WALLET         | the programme's escrow             | subscription → `ACTIVE`               |
| `WALLET_TOPUP`      | none             | TRANSFER, CARD | the wallet, net of fee, by webhook | referral qualification (ADR-012)      |

A target that is not the caller's reports as 404, never 403, so the endpoint
cannot be used to learn that someone else's due exists or what it is for.

A paid Food enrolment withdrawn while the programme is still `OPEN` is refunded
from escrow to the wallet in the same transaction as the withdrawal. Once the
programme is `ACTIVE`, buying has begun and withdrawal is refused.

## Methods

Every intent returns `methods`, the methods its target accepts. The app offers
exactly those, and `confirm` refuses any other with 422 **before** checking the
PIN, so a refused method costs no attempt.

`WALLET` settles inside the request: the balance check, the ledger posting and
the target's `settle` happen in one serializable transaction, so there is no
window where a due is paid with no money behind it.

`TRANSFER` and `CARD` move to `PROCESSING`. Per
[ADR-006](adr/ADR-006-monnify-webhooks-and-sandbox-verification.md), only a
signature-verified webhook may complete an external payment — never the client
returning from a checkout page. `PaymentSettlementService` then credits the
payer's wallet (ADR-010).

That is why products are paid from the wallet and only a top-up uses the
external rails: an external payment for a due would arrive as a deposit and
leave the due unpaid. A member who is short tops up first, then pays. ADR-013
records the alternative considered.

## Fees

Only a wallet top-up carries a fee: it is the one payment that brings money in
from outside, and it is priced cost-plus
([ADR-009](adr/ADR-009-platform-fee-model.md)). Every other target moves money
already inside the ledger and returns `feeMinor: "0"` explicitly. When the fee is
zero the fee leg is omitted from the posting entirely, so no zero-amount rows
enter the ledger.

## Idempotency

Both write routes require `Idempotency-Key` (8–128 characters). The key is stored
on the intent, unique per `(userId, idempotencyKey)` and enforced by a database
constraint, so two concurrent taps cannot both create an intent. A repeat returns
the original intent rather than an error — a retrying client needs the same
answer, not a conflict.

## PIN handling

`confirm` verifies the PIN through `TransactionPinService`, which locks after
five consecutive failures. The PIN is checked **before** the intent transitions,
so a mistyped digit leaves the payment retryable instead of burning it. The
confirm route is additionally throttled to 10 requests per minute.

## Verified behaviour

Exercised end to end against a local server on 2026-09-02: a ₦5,000.00 pool due
was paid from a funded wallet; the balance fell by exactly that amount, the due
became `PAID` carrying its ledger transaction id, and the posting balanced
(one debit, one credit, no fee leg). Re-confirming did not charge again, a second
intent for the paid due was refused with 409, a wrong PIN left the due `PENDING`,
another user received 404 for both the due and the intent, and a transfer stopped
at `PROCESSING` without moving money.
