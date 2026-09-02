# ADR-009: Cost-plus tiered platform fees

- Status: Accepted
- Date: 2026-09-02
- Supersedes the flat-band pricing recorded in `docs/open-questions/platform-fee-model.md` on 2026-09-01.

## Context

The 2026-09-01 decision priced deposits as flat bands — ₦50 up to ₦10,000, ₦100 from ₦10,000, ₦150
from ₦200,000, ₦200 from ₦500,000 — with the platform absorbing the provider's own charge. Against
a provider rate of 1.5% that model is loss-making above roughly ₦3,300: a ₦50,000 deposit costs the
platform ₦750 and charges ₦100, and a ₦500,000 deposit loses ₦7,300. The loss grows with the
deposit, so the model fails hardest on the customers worth most.

The schema could not express a band in any case. `FeeDefinition.calculationType` is `FIXED` or
`PERCENTAGE` with an optional min/max clamp, and a step function is neither.

## Decision

### Deposits are priced cost-plus, floored at a percentage

```
charge = max(percentageOf(amount), providerCost(amount) + markup(amount))
```

Taking the greater of the two means the platform never sells below cost, and margin scales with the
amount rather than staying flat. The percentage floor is what earns on large deposits; the
cost-plus arm is what protects small ones, where a bare percentage would not cover the provider's
own charge.

The markup is tiered, which is the only banded part of the model:

| Deposit           | Markup |
| ----------------- | ------ |
| below ₦10,000     | ₦50    |
| ₦10,000 and above | ₦100   |

With a 2% floor and a 1.5% provider rate this reproduces the modelled cases exactly: ₦1,000 is
charged ₦65 for ₦50 of margin, and ₦15,000 is charged ₦325 for ₦100.

### Payouts are cost-plus flat

A payout is charged the provider's transfer cost plus ₦5. Outbound transfer pricing is per
transaction rather than proportional, so a percentage would misprice it in both directions.

### Band boundaries are half-open

A tier covers `fromMinor <= amount < toMinor`. A deposit of exactly ₦10,000 therefore pays the
upper tier's markup. Every tier set is validated to partition its whole range with no overlap and
no gap; a set that does not is rejected at assessment rather than silently picking a tier. The
ambiguity in the source brief — "up to ₦10,000" and then "from ₦10,000" — is resolved this way at
every threshold, because an off-by-one at a band edge is a money bug that surfaces only in
reconciliation.

### Provider rates are configuration, not code

The provider's own cost is expressed as a versioned fee definition, not a constant in a function.
No Monnify pricing is documented in this repository; the 1.5% deposit and flat payout figures come
from commercial modelling and are **unverified against official provider documentation or the
commercial agreement**. Storing them as seeded, versioned data means correcting them is a seed
change with an audit trail, not a code change — and `FeeAssessment.ruleSnapshot` records which
version actually applied to each charge.

### Schema

A `FeeTier` model — `feeDefinitionId`, `fromMinor`, `toMinor`, `amountMinor`, ordered — with a
`TIERED` calculation type, and `providerRateBasisPoints` / `providerFlatMinor` on `FeeDefinition`
so a definition can describe the provider cost it is marking up. This keeps the existing versioning,
effective dating, and rule snapshot.

Encoding each band as its own definition row is rejected: it makes "which rule applied" ambiguous
after the fact, which is not acceptable for a ledgered fee.

## Consequences

Fees are now computable, so `feeFor` can stop returning `0n` and the ledger's fee-revenue leg can
carry a real amount.

**A minimum deposit is now required and is not part of this ADR.** Cost-plus pricing is regressive
at very small amounts: a ₦100 deposit would be charged ₦51.50, which is 51% of it. That is a
product floor, not a fee rule, and it must be set before deposits open to users.

Unresolved and deliberately out of scope: whether a fee is refundable when its transaction reverses
(`FeeDefinition.refundable` exists but no policy is set, and a reversed transaction must not
silently keep its fee); whether Ajo group-admin and defaulter fees use this mechanism or a
group-scoped one; and whether any fee is ever netted from the amount received rather than charged
to the payer.
