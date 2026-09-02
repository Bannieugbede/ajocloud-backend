# Open platform fee model questions

**Largely resolved by [ADR-009](../adr/ADR-009-platform-fee-model.md) on 2026-09-03.** Deposits are
priced cost-plus with a tiered markup floored at a percentage; payouts are the provider's transfer
cost plus a flat markup; band boundaries are half-open (`fromMinor <= amount < toMinor`); and rates
live in versioned `FeeDefinition` rows rather than in code. `FeeTier` and the `TIERED` calculation
type implement it, and `FeesService` resolves the active definition at assessment time.

The earlier flat-band pricing recorded here on 2026-09-01 was superseded: against a 1.5% provider
rate it was loss-making on every deposit above roughly ₦3,300, and the loss grew with the deposit.

## Still open

- **A minimum deposit must be set as a product decision.** Cost-plus pricing is regressive at very
  small amounts — a ₦100 deposit would be charged ₦51.50. `MINIMUM_DEPOSIT_MINOR` currently refuses
  anything under ₦500, which is an engineering placeholder chosen to keep the fee under about 10%,
  not an approved commercial figure.
- **Provider pricing is unverified.** The 1.5% deposit rate and ₦20 flat payout cost are commercial
  modelling assumptions, not figures read from Monnify's official documentation or the commercial
  agreement. They are seeded configuration precisely so correcting them is a data change with an
  audit trail, but they must be confirmed before production.
- **Refundability when a transaction reverses.** `FeeDefinition.refundable` exists but no policy is
  set, and a reversed transaction must not silently keep its fee. This is why ADR-010 leaves
  reversal events to manual reconciliation rather than posting them.
- **Whether Ajo group-admin and defaulter fees** use this mechanism or a separate, group-scoped one.
- **Whether any fee is ever netted from the amount received** rather than charged to the payer, per
  product. Deposits net the fee (ADR-010) because there is no second opportunity to collect; nothing
  else has been decided.
