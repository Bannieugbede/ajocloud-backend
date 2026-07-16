# Current status

- Last updated: 2026-07-16
- Current phase: Financial-core hardening plus staged Traditional Ajo, Food Coordinator, and Bill Payment delivery

## Complete

Foundation bootstrap/infrastructure/docs; auth/session rotation; live permissions; users/profile; wallet ownership reads; append-only ledger posting/reversal; audit/idempotency; Docker/CI; fixed and flexible whole-unit Ajo creation/locking/calendars/versioned swaps; versioned fee snapshots; Food Coordinator application/review/approval/suspension; provider-neutral Bill Payment catalog/validation/reservation/payment/manual reconciliation/provider reversal/receipt; KYC tier/provider boundaries; configurable referral and notification policies; Akawo schema expansion; public brand configuration; and an additive migration verified on PostgreSQL 18.

## In progress

No roadmap item is intentionally marked in progress at this handoff. Partial product areas are explicitly **NOT STARTED**, **BLOCKED**, or **DEFERRED / POST-MVP** rather than presented as complete.

## Blocked

The real Monnify Bill Payment adapter/webhook and real Monnify/Dojah KYC adapters are blocked by absent verified provider contracts. Multiple Ajo payout recipients/default handling, the ambiguous referral “#5” rule, and production fee limits require product/compliance decisions. Brevo remains under consideration. Docker is unavailable, but PostgreSQL 18 from Postgres.app was used to apply both migrations and run transaction tests.

## Next recommended tasks

1. Add service-level PostgreSQL concurrency/replay tests for group locking/swaps and the complete Bill Payment orchestration.
2. Implement scheduled provider inquiry plus durable outbox relay/inbox consumers and notification workers.
3. Obtain and review current Monnify/Dojah specifications and commercial terms before implementing real adapters or webhooks.
4. Approve Ajo default/multiple-recipient rules and the referral qualification ambiguity.
5. Implement Food Ajo programme/procurement/distribution and Akawo ledger workflows without exposing schema-only endpoints.

## Unresolved decisions and risks

See ADR-001/002/003 and all open questions. Primary risks are absent provider verification, incomplete service-level concurrency/replay coverage, manual rather than scheduled Bill Payment reconciliation, no verified webhook intake, no rate-limit Redis storage, no device/MFA APIs, and schema-only portions of Food Ajo, Akawo, KYC, referrals, and notifications.

## Verification and migrations

Final `bun run check` passed: Prisma validation/generation, formatting, lint, strict typecheck, 49 unit tests across 15 suites, and build. The explicit Prisma format/validate/generate, format check, lint, typecheck, `bun run test`, E2E, and build commands also passed; E2E passed 1 test. Both migrations applied cleanly to isolated PostgreSQL 18 databases, Prisma detected no schema drift, and the forced database integration suite passed 2 tests covering serializable reservation/idempotency and the Bill Payment total-debit constraint.
