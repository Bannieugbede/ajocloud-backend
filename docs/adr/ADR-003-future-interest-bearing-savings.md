# ADR-003 — Future interest-bearing Akawo savings

- Status: Accepted boundary; implementation deferred / post-MVP
- Date: 2026-07-16

## Decision

Akawo MVP is non-interest-bearing and must not advertise, accrue, calculate, or promise yield. A future interest-bearing product requires an approved regulated institutional partner, legal and compliance approval, signed commercial terms, product eligibility and disclosures, settlement and reconciliation design, tax/withholding rules, and customer consent.

Technical configuration or a feature flag alone can never activate interest. Provider-facing interfaces may be introduced behind the Akawo boundary, but product enrolment, accrual, distribution, settlement, and statement models remain **DEFERRED / POST-MVP** until the institutional arrangement and financial rules are approved.

No Moniepoint or other third-party rate is a business rule. Rates must be effective-dated provider product data and verified under the organisation's current agreement before any later implementation.

## Consequences

Current balances remain ledger-backed savings principal only. Future designs must support interest opt-in/opt-out, a non-interest or faith-compatible option, eligibility, partner settlement, yield distribution, withholding records, statements, and reconciliation without changing historical MVP savings semantics.
