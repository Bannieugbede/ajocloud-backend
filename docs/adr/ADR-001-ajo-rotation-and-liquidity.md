# ADR-001 — Ajo rotation and liquidity

- Status: Accepted for fixed Ajo; flexible units are governed by ADR-002
- Date: 2026-07-16

## Decision

The fixed-Ajo MVP uses one fixed group contribution amount and whole slots. A member may own multiple slots; each slot contributes the same amount every cycle and receives exactly one payout position. For `N` active slots, every cycle collects `N × contributionMinor` and pays exactly that amount to one slot. Odd and even counts use the identical formula and integer arithmetic. ADR-002 extends the model with administrator-defined smallest whole units; it does not authorize fractional units or platform float.

The full rotation is generated before lock, must fit the configured maximum 12-month window, and becomes immutable when locked. Slot swaps require both affected owners, expire if not approved, and create a new immutable payout-schedule version. Arbitrary custom amounts, fractional slots, unapproved multiple-recipient execution, and in-place schedule mutation after lock are unsupported.

## Consequences

The model is solvent per cycle only if every contribution is collected. The platform provides no liquidity float and never funds a shortfall. Default handling may delay/hold payout; it must not silently spend platform funds. Members, rather than people, do not determine pool size—slots do—so multiple-slot owners carry multiple obligations and payout positions.

The one-recipient-per-cycle model limits feasible slot counts by frequency and the 12-month duration (for example, 1,000 slots cannot complete monthly). This honest constraint is preferable to inventing liquidity or multiple-recipient rules.

## Alternatives rejected for now

Fractional/share slots complicate rounding and entitlement; custom contributions break equal-pool reasoning; platform buffers expose regulated capital; multiple recipients per cycle need an approved allocation/default model. All remain blocked in [open questions](../open-questions/ajo-financial-rules.md).
