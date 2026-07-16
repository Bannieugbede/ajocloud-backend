# ADR-002 — Flexible Ajo contribution model

- Status: Accepted for MVP data model and locking rules
- Date: 2026-07-16

## Context

Flexible Ajo must permit different approved contribution amounts without creating fractional-money rounding, an unreconciled rotation, or an implicit loan from Ajo Cloud. Member count, contribution-unit count, and payout-position count are distinct.

## Options considered

1. **Whole-slot contribution units.** A smallest unit is configured and members hold integer quantities. Simple, deterministic, and compatible with the existing slot scheduler.
2. **Share-based contribution units.** Arbitrary shares permit more choice but need rounding and residual-allocation rules.
3. **Independent member contribution plans.** Each member has an unrelated obligation; this does not inherently produce a solvent pooled rotation.
4. **Proportional pooled distribution.** Each period is distributed by weight; defaults change every recipient's entitlement and need approved loss allocation.
5. **Fractional payout units.** More expressive, but introduces rounding and fractional-position governance.
6. **Platform-funded liquidity buffering.** Hides collection shortfalls with platform capital and creates credit, capital, and regulatory exposure.
7. **No-platform-float models.** Payouts are limited to reconciled group funds; shortfalls are held or handled under an approved default rule.

## Decision

The MVP uses whole-number contribution units and no platform float. The administrator defines a positive smallest contribution unit in integer minor units. Each member selects an approved integer unit quantity; each unit maps to one payout entitlement and one payout position. Obligations and entitlements are frozen before activation.

Locking must deterministically generate the complete versioned schedule and prove:

- every active unit has an obligation in every applicable cycle;
- total expected inflows equal total scheduled outflows, per cycle and over the lifecycle;
- all amounts use one currency and integer minor units;
- the schedule completes within 12 months;
- no negative, fractional, residual, or platform-funded amount exists.

Multiple recipients in a period are representable, but may only be enabled when recipient grouping and default handling have been approved. Until then, the existing one-entitlement-per-cycle execution policy remains the operational default. Locked terms are immutable; changes create a new schedule version and audit history.

## Consequences

Different member amounts are expressed as integer multiples of the configured unit. This intentionally rejects arbitrary amounts. A group cannot lock when projected inflows and outflows do not reconcile exactly. Platform liquidity, fractional units, proportional loss allocation, and independent-plan pooling remain prohibited without a replacement ADR and compliance approval.

See [flexible Ajo open questions](../open-questions/flexible-ajo-contribution-rules.md).
