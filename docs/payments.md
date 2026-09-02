# Payments

One payment contract serves every product. Akawo pool dues, Ajo contributions,
Food subscriptions and wallet top-ups all create a **payment intent**, confirm it
with a method and the transaction PIN, and settle through the same ledger path.

The design and its trade-offs are in
[ADR-008](adr/ADR-008-shared-payment-intents.md).

## Routes

All require a bearer token. Money is always integer minor units serialised as
strings.

| Route                                       | Purpose                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/v1/payments/intents`             | Create an intent for a target. Requires `Idempotency-Key`. |
| `POST /api/v1/payments/intents/:id/confirm` | Confirm with a method and PIN. Requires `Idempotency-Key`. |
| `GET  /api/v1/payments/intents/:id`         | Read one intent; polled while `PROCESSING`.                |
| `GET  /api/v1/wallets/me/balance`           | Available balance, to offer or grey out the wallet method. |

## The amount is never supplied by the client

`CreateIntentDto` has **no amount field**. The amount is read from the target row
— the pool due, the schedule — by `resolveTarget`, and re-read inside the
settlement transaction. If it changed in between, settlement is refused rather
than posting a stale figure.

This is the load-bearing rule of the module. A client-supplied amount would let a
member settle a ₦50,000 due for ₦1 and still have it marked `PAID`. A test asserts
the service source never reads an amount from the DTO, because a behavioural test
would not catch a field added later.

## Targets

`targetType` plus `targetId`, not a foreign key per product.

| Target              | Status                                                    |
| ------------------- | --------------------------------------------------------- |
| `AKAWO_POOL_DUE`    | Implemented. Settles the due and posts the ledger.        |
| `AJO_CONTRIBUTION`  | Refused with 422 until the Ajo schedule is payable.       |
| `FOOD_SUBSCRIPTION` | Refused with 422 until Food subscriptions exist.          |
| `WALLET_TOPUP`      | Refused with 422: no funding contract defines the amount. |

Unimplemented targets are refused explicitly rather than creating an intent that
could never be paid.

## Methods

`WALLET` settles inside the request: the balance check, the ledger posting and
the target's transition happen in one serializable transaction, so there is no
window where a due is paid with no money behind it.

`TRANSFER` and `CARD` move to `PROCESSING` and stop there. Per
[ADR-006](adr/ADR-006-monnify-webhooks-and-sandbox-verification.md), only a
signature-verified webhook may complete an external payment — never the client
returning from a checkout page. **The webhook handler that completes them is not
yet written**, so a transfer or card payment currently starts and then waits
indefinitely. Wallet payments are complete today.

## Fees

`feeMinor` is always `0`, and is returned explicitly so an unimplemented fee
cannot be mistaken for a free product. The banded model in
[open-questions/platform-fee-model.md](open-questions/platform-fee-model.md) is
undecided: its boundaries overlap at every threshold ("up to ₦10,000" then "from
₦10,000"), and guessing one is a money bug that surfaces only in reconciliation.

The column, the API field, and the fee-revenue ledger leg all exist and are
exercised; only `feeFor` needs to change when the model is settled. While the fee
is zero the fee leg is omitted from the posting entirely, so no meaningless
zero-amount rows enter the ledger.

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
