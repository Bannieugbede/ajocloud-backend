# ADR-013 — One payment contract, with each product as a target

- Status: Accepted
- Date: 2026-09-26
- Extends: [ADR-008](ADR-008-shared-payment-intents.md),
  [ADR-010](ADR-010-webhook-ledger-posting.md),
  [ADR-011](ADR-011-ajo-contribution-and-payout-execution.md)

## Context

ADR-008 gave every product one payment aggregate, the intent, but only Akawo
pool dues and wallet top-ups could use it. `AJO_CONTRIBUTION` and
`FOOD_SUBSCRIPTION` were refused with 422, so:

- Ajo contributions were paid through a route of their own
  (`POST /ajo-groups/:id/contributions/:scheduleId/pay`), without the PIN and
  with none of the intent's quote, expiry or receipt.
- Food subscriptions could not be paid at all. A member enrolled and the
  programme's procurement plan reported what they owed, but nothing collected
  it.

Two defects also sat in the shared path:

- **A due paid by card or transfer was never marked paid.** The external rails
  settle through `PaymentSettlementService`, which credits the payer's wallet as
  a deposit (ADR-010). The due stayed `PENDING` while the member believed they
  had paid it.
- **A top-up could be "paid" from the wallet.** `WALLET` was accepted for every
  target, and for a top-up it debited the wallet and credited provider-payable:
  money out of the wallet, labelled as money in.

Both come from the same cause: the service knew about products through a
`switch`, and nothing stated which methods each product could actually be
settled by.

## Decision

### Each product is a `PaymentTarget`

`PaymentsService` owns what every payment shares: idempotency, the PIN, the
balance check, the ledger posting, expiry, and the audit record. It asks the
target only what differs between products:

| Question                                     | Member                                       |
| -------------------------------------------- | -------------------------------------------- |
| What does it cost, and may this user pay it? | `resolve`                                    |
| Where does the money go?                     | `creditAccount`                              |
| What changes once it is paid?                | `settle`, in the posting's transaction       |
| Which methods can pay it?                    | `methods`                                    |
| Who decides the amount?                      | `amountRule`: `fixed`, `chosen` or `partial` |
| What is it called on a receipt?              | `describe`, which never throws               |

A target lives in the module that owns the product (`AjoContributionTarget` in
`ajo-groups`, `FoodSubscriptionTarget` in `food-ajo`), so the rules for paying
for something sit next to the thing. `PaymentsModule` imports those modules and
builds a registry that refuses, at boot, any `PaymentTargetType` without exactly
one target.

### Product targets are paid from the wallet

| Target              | Methods        | Amount  | Credited to                |
| ------------------- | -------------- | ------- | -------------------------- |
| `AKAWO_POOL_DUE`    | WALLET         | fixed   | Provider payable           |
| `AJO_CONTRIBUTION`  | WALLET         | partial | The group's pool (ADR-011) |
| `FOOD_SUBSCRIPTION` | WALLET         | fixed   | The programme's escrow     |
| `WALLET_TOPUP`      | TRANSFER, CARD | chosen  | The wallet, by webhook     |

A member whose wallet is short tops it up, then pays. The intent returns
`methods`, the app offers exactly those, and `confirm` refuses any other
**before** the PIN is checked, so a refused method costs no PIN attempt.

The alternative was to let a card pay a due directly and have the webhook apply
the credit to the due. That needs the deposit fee (ADR-009) on a product
payment, which is only known once the method is chosen, after the intent has
already quoted a total; and a due that changed or was paid while the card was
in flight would leave money with nowhere to go but the wallet anyway.
Fund-then-pay has one settlement path for money arriving from outside and one
for money moving inside, and each is already proven.

### Ajo contributions may be paid in part

Flexible groups collect in whole units, so owing part of a round is ordinary
(ADR-002). A requested amount is accepted up to what is still owed; nothing
requested means all of it. This does not reopen ADR-008's underpayment concern,
because a schedule's status is derived from what has arrived
(`contributionScheduleStatusFor`): a part payment leaves it `PARTIALLY_PAID`
and can never mark it `PAID`.

The contribution is recorded by `AjoSettlementService.recordContributionWithin`,
the same code the Ajo route uses, so payouts and statements see one kind of
contribution however it was paid. The Ajo route remains for compatibility.

### Food subscriptions are paid in full, into escrow, and refundable until buying begins

A subscription costs the package's locked price for each portion. Paying it
moves the money into a per-programme `FOOD_PROGRAMME_ESCROW` liability account
and the subscription from `PENDING` to `ACTIVE`. Payment is accepted while the
programme is `OPEN` or `ACTIVE`.

Withdrawing a paid enrolment refunds it from escrow to the wallet in the same
transaction, but only while the programme is `OPEN`. Once it is `ACTIVE`, buying
has begun against the enrolments of that moment and the money is committed to a
vendor, so withdrawal is refused. The procurement plan now reports
`collectedMinor` beside `expectedMinor`, so a coordinator can size orders by
money actually held.

## Consequences

- Adding a product is implementing `PaymentTarget` and registering it; the
  service does not change.
- The app has one payment flow for every product, driven by `methods` rather
  than by knowledge of each product.
- Intents created before this change for a due paid by card or transfer, if
  any complete, still settle as a wallet deposit: the member's money is in their
  wallet and the due is payable from it.
- Moving escrow to a vendor, and releasing an Akawo organiser's collection, are
  still to be built; both are out of scope here.
