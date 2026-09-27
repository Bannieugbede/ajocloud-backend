# ADR-014 — Bill payments are paid through the payment intent

- Status: Accepted
- Date: 2026-09-27
- Extends: [ADR-013](ADR-013-payment-targets.md)

## Context

Every product paid through the shared payment intent (ADR-013) except bills.
`POST /bill-payments` debited the wallet directly: no transaction PIN, no
quoted fee, no expiry, and no way for the app's payment screens (method, PIN,
top-up when short, result) to handle it. A stolen session could empty a wallet
into airtime.

A bill differs from the other targets in one way. Paying a due is finished when
money moves; paying a bill is finished only when the provider says so, and the
provider must not be called inside a database transaction.

## Decision

Bills are a `PaymentTarget`, `BILL_PAYMENT`, whose target is the customer
validation the payment quotes. The direct route is removed.

| Question    | Answer                                                                                 |
| ----------- | -------------------------------------------------------------------------------------- |
| Methods     | WALLET                                                                                 |
| Amount      | `chosen` (airtime and electricity), but a fixed-price package refuses any other figure |
| Fee         | `BILL_PAYMENT`, assessed at quote time and shown in it                                 |
| Credited to | The payer's `WALLET_RESERVED` account, **with the fee** (`holdsFee`)                   |
| Settle      | Records the `BillPayment` (PENDING) and its attempt in the same transaction            |

Two optional members are added to `PaymentTarget`, so the other targets are
unchanged:

- `verifyConfirmation` runs before the PIN. A bill needs the customer's number
  to send to the provider, and only a digest of it is stored, so the confirm
  request carries it (`customerReference`). It must match the validation's
  digest; it is used for that request and never stored or logged. A mismatch
  costs no PIN attempt.
- `afterCommit` runs after the settlement transaction. A target that has one is
  left `PROCESSING` by the transaction; `afterCommit` calls the provider and the
  bill module moves the intent on:

| Provider says       | Bill                    | Intent     | Ledger                                              |
| ------------------- | ----------------------- | ---------- | --------------------------------------------------- |
| Success             | SUCCESSFUL              | SUCCEEDED  | Reserved → provider payable (amount) + fee revenue  |
| Declined            | FAILED                  | FAILED     | Reserved → available (amount and fee)               |
| Timeout / uncertain | RECONCILIATION_REQUIRED | PROCESSING | Unchanged; reconciliation settles or releases later |

These are the bill module's existing settle, release and reconcile postings,
unchanged. They already expected the reserve to hold the whole debit, which is
why the fee is held rather than recognised when the intent posts. Reconciling a
bill also moves its intent to its final state, so the app's result screen, which
polls a `PROCESSING` intent, sees it finish.

## Consequences

- Every payment a member makes, bills included, now needs the transaction PIN
  and goes through one set of screens.
- Clients of `POST /bill-payments` must move to `POST /payments/intents`
  (`targetType: BILL_PAYMENT`, `targetId: <validationId>`, `amountMinor`) and
  confirm with `customerReference`. The mobile app is the only client.
- A validation lasts fifteen minutes, as does an intent. A payment confirmed
  after its validation lapsed is refused with "Check the number again"; nothing
  moves.
