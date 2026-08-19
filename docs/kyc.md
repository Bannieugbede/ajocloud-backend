# Progressive KYC

Tier 1 covers basic account data and has restricted capabilities. Tier 2 adds BVN, bank-account inquiry/linking, name matching, and address details. Tier 3 adds NIN/vNIN, face match, liveness, address evidence, risk-based source-of-funds information, and manual review where required.

Food Coordinator approval and configured high-risk/high-value actions require verified Tier 3. Dojah is intended primarily for approved biometric checks rather than every user; Monnify may provide supported account/identity checks only after verification of current capabilities.

Verification capabilities use separate provider interfaces. Persisted checks contain type, provider/reference, masked identifier, state, timestamps, safe result summary, failure, risk flags, reviewer, and raw-data expiry—not raw BVN, NIN, face images, or biometric payloads. Any exceptional sensitive-data storage requires approved purpose, field-level encryption, access audit, retention, and deletion policy.

## Implemented (2026-08-19)

Tier 2 is implemented for BVN/NIN and bank-account inquiry under
[ADR-004](adr/ADR-004-identity-verification-provider-and-data-policy.md), with **Dojah** as the
provider. Raw identity numbers are never persisted: the prohibition above is enforced in
`KycService` and asserted by tests that search every persisted and audited payload for the
identifier. Name matching is advisory and routes to review rather than rejecting. Tier 3 face
match and liveness remain unimplemented.
