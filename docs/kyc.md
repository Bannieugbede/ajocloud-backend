# Progressive KYC

Tier 1 covers basic account data and has restricted capabilities. Tier 2 adds BVN, bank-account inquiry/linking, name matching, and address details. Tier 3 adds NIN/vNIN, face match, liveness, address evidence, risk-based source-of-funds information, and manual review where required.

Food Coordinator approval and configured high-risk/high-value actions require verified Tier 3. Monnify is the single provider for payments, verification, and payouts ([ADR-005](adr/ADR-005-monnify-as-single-financial-and-identity-provider.md)). Tier 3 biometric coverage is not established for Monnify and must be settled by the Tier 3 ADR.

Verification capabilities use separate provider interfaces. Persisted checks contain type, provider/reference, masked identifier, state, timestamps, safe result summary, failure, risk flags, reviewer, and raw-data expiry—not raw BVN, NIN, face images, or biometric payloads. Any exceptional sensitive-data storage requires approved purpose, field-level encryption, access audit, retention, and deletion policy.

## Implemented (2026-08-19)

Tier 2 is implemented for BVN/NIN and bank-account inquiry. The identity-data policy is
[ADR-004](adr/ADR-004-identity-verification-provider-and-data-policy.md); the provider is **Monnify**
under [ADR-005](adr/ADR-005-monnify-as-single-financial-and-identity-provider.md). vNIN is not
supported by Monnify and is refused rather than misrouted to the NIN endpoint. Raw identity numbers are never persisted: the prohibition above is enforced in
`KycService` and asserted by tests that search every persisted and audited payload for the
identifier. Name matching is advisory and routes to review rather than rejecting. Tier 3 face
match and liveness remain unimplemented.
