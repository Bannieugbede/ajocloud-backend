# Architecture decision records

- [ADR-001: Ajo rotation and liquidity](ADR-001-ajo-rotation-and-liquidity.md) — accepted safe MVP baseline with open product questions.
- [ADR-002: Flexible Ajo contribution model](ADR-002-flexible-ajo-contribution-model.md) — whole contribution units, exact reconciliation, and no platform float.
- [ADR-003: Future interest-bearing Akawo savings](ADR-003-future-interest-bearing-savings.md) — regulated-partner prerequisite; deferred post-MVP.
- [ADR-004: Identity verification provider and identity-data policy](ADR-004-identity-verification-provider-and-data-policy.md) — raw identifiers are never persisted; provider choice superseded by ADR-005.
- [ADR-005: Monnify as the single payments, verification, and payout provider](ADR-005-monnify-as-single-financial-and-identity-provider.md) — one vendor for money and identity; Dojah removed.
- [ADR-006: Monnify webhook ingestion and sandbox verification fallback](ADR-006-monnify-webhooks-and-sandbox-verification.md) — signed raw-body webhooks, replay-safe inbox, and a production-forbidden sandbox KYC fallback.

Financial-rule changes require a new ADR or an explicit update to an existing one.
