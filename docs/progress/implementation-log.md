# Implementation log

## 2026-07-16 — Mobile account verification support

- Work: Extended registration with Nigerian phone and versioned Terms/Privacy consent; added phone then email OTP verification, resend, account activation, token expiry metadata, and delivery/audit persistence.
- Security: Argon2id passwords; challenge-bound HMAC OTP digests; ten-minute expiry; five attempts; sixty-second cooldown; endpoint throttling; no raw OTP persistence/logging; no session before both channels verify.
- Database: Added `20260716180000_account_verification` with challenge/consent enums, tables, constraints, foreign keys, and lifecycle indexes.
- Seeds/tests: Added verified, phone-pending, and email-pending personas plus deterministic digest-only test codes; added DTO and verification policy tests.
- Limitation: Console/mock delivery is development-only; production SMS/email adapters and credentials remain external deployment work.

## 2026-07-16 — Product-scope expansion

- Work: Standardized Akawo naming; added ADRs/open questions/product references; expanded Ajo whole-unit modes, capacity, calendars, schedule versions, swaps, and fee snapshots; implemented Food Coordinator application/review/approval/suspension; implemented provider-neutral Bill Payment with wallet reserves, reconciliation and reversal; added progressive KYC/referral/notification boundaries and public brand configuration.
- Database: Added `20260716120000_product_scope_expansion`, generated from the prior schema and then made data-safe with legacy backfills. Added product enums/tables/indexes/check constraints and a partial unique coordinator-application index. Existing savings table names were retained.
- Providers: Mock Bill Payment and console email are development adapters. Monnify Bill Payment and Brevo classes deliberately fail closed; real Monnify/Dojah/Brevo traffic is not implemented without verified current specifications and approval.
- Financial safety: Integer minor units only; serializable reserve and settlement boundaries; available/reserved/provider-payable/fee accounts; confirmed failure release; timeout/unknown hold; idempotent ledger commands; immutable receipts/reversals; audit/outbox events; exact Ajo unit reconciliation and no platform float.
- Tests: Added large-group/calendar/flexible-Ajo/swap/fee, Food Ajo/coordinator, Bill Payment provider/reserve policy, KYC masking/tier, referral qualification, notification quiet-hours/dedupe, brand, and PostgreSQL financial-invariant tests.
- Verification: Both migrations applied twice from empty to isolated local PostgreSQL 18 databases; migration status was current and Prisma detected no schema drift. The forced PostgreSQL integration suite passed 2 tests after correcting one adapter-specific assertion. Prisma format/validate/generate, format check, lint, strict typecheck, 49 unit tests, 1 E2E test, build, and the aggregate check passed.
- Roadmap: Recalculated from actual product workflows to 58/122 complete (47.5%); provider-contract blockers and post-MVP institutional savings remain explicit.

## 2026-07-16 — Production foundation

- Work: Replaced the Nest starter with a Fastify modular monolith; implemented configuration, logging, health, auth/session rotation, permissions, users, Ajo workflow, wallets, ledger, audit, idempotency, Redis/RabbitMQ/BullMQ foundations, worker/scheduler, Docker, CI, seeds, and docs.
- Files/modules: `src`, `prisma`, `.github`, container/environment configuration, and all required documentation.
- Migration: generated initial PostgreSQL migration; not applied locally because Docker is unavailable.
- Tests: environment, Ajo odd/even/multiple-slot/capacity/duration/exact-pool rules, ledger balance rejection, and Fastify health endpoint.
- Decisions: integer minor units; equal whole slots; one recipient per cycle; no platform float; immutable locked schedule; live database-backed sessions/permissions.
- Security: Argon2id, hashed rotating refresh tokens with reuse revocation, strict DTOs/CORS/headers/rate limits, scoped authorization, secret/audit redaction, non-root image.
- Remaining: provider adapters/webhooks, integration/concurrency tests, outbox relay/consumers, swap/penalty/contribution/payout services, later product modules, and production readiness work.
- Quality: format, lint, strict typecheck, Prisma validate/generate, build, 12 unit tests, and 1 Fastify E2E test passed. Integration command found no tests. Coverage was 10.14% statements overall. Migration status failed only because local PostgreSQL was unavailable. Audit found two moderate transitive advisories and no high/critical findings.
