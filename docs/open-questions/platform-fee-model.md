# Open platform fee model questions

The commercial model was decided on 2026-09-01: **charges are passed to users**. Withdrawals take
₦10 per withdrawal plus ₦50 on transactions up to ₦100,000. Deposits take ₦50 up to ₦10,000, ₦100
from ₦10,000, ₦150 from ₦200,000, and ₦200 from ₦500,000. Every figure excludes Monnify's own
charges, which must be verified against the current official documentation and the commercial
agreement before production use.

That decision is not yet implementable, for two reasons.

## The schema cannot express a banded fee

`FeeDefinition` supports `calculationType` of `FIXED` or `PERCENTAGE`, with an optional
`minimumMinor`/`maximumMinor` clamp. The decided model is a step function over transaction bands,
which is neither. `assessVersionedFee` in `src/modules/fees/domain/fee-rule.ts` therefore cannot
produce the right amount for any deposit above ₦10,000.

The recommended change is a `FeeTier` model — `feeDefinitionId`, `fromMinor`, `toMinor`,
`amountMinor`, ordered — with a `TIERED` calculation type, validated so that tiers neither overlap
nor leave gaps. This keeps `FeeDefinition`'s existing versioning and effective dating, and keeps the
rule snapshot that `FeeAssessment.ruleSnapshot` relies on for the audit trail.

Encoding each band as a separate definition row is rejected: it makes “which rule applied” ambiguous
after the fact and weakens the audit trail, which is not acceptable for a ledgered fee.

## Band boundaries are ambiguous and must be stated explicitly

The source brief reads “up to ₦10,000” and then “from ₦10,000”. Those overlap at exactly ₦10,000,
so the fee at that amount is undefined — it could be ₦50 or ₦100. The same ambiguity repeats at
every threshold.

Before any fee code is written, each boundary must be stated as inclusive or exclusive, so that the
bands partition the whole range with no overlap and no gap. An off-by-one at a band edge is a money
bug, and it is the kind that only shows up in production reconciliation.

## Also unresolved

- Whether the ₦50 withdrawal component applies to the whole range up to ₦100,000 or stacks with the
  ₦10 per-withdrawal charge, and what applies above ₦100,000.
- Whether fees are charged to the payer or netted from the amount received, per product.
- Whether Ajo group admin fees and defaulter fees are the same mechanism as platform fees or a
  separate, group-scoped one.
- Whether any fee is refundable when the underlying transaction reverses. `FeeDefinition.refundable`
  exists but no policy has been set, and a reversed transaction must not silently keep its fee.

Until these are settled, no `FeesModule`, controller, service, or seeded definition should be
written. Only the domain function and its spec exist today, which is the correct state for an
undecided rule.

## What this does and does not block (2026-09-02)

It no longer blocks payments. `PaymentIntent` carries `feeMinor`, the API returns it, and the
ledger posting has a fee-revenue leg — but `feeFor` in
`src/modules/payments/domain/payment-policy.ts` returns `0n`, and the fee leg is omitted from the
posting while it does, so no zero-amount rows enter the ledger. A test pins the zero so the model
landing is a deliberate change rather than a silent one.

So the open question now blocks exactly one thing: what `feeFor` should return. When the boundaries
above are stated, that function and the `FeeTier` schema are the whole change; no payment route,
controller, or settlement path needs to move.
