# Implementation log

## 2026-07-17 — Email-only account verification

- Replaced the two-stage phone/email registration flow with one email challenge created during
  registration. Phone is no longer accepted by the registration DTO or required before activation.
- Removed the public phone-verification route, channel selection from resend, SMS delivery from the
  verification service, and the account-verification SMS template.
- Updated deterministic seed data to one email-pending persona while retaining email/password login,
  challenge HMAC/expiry/attempt/cooldown controls, secure session issuance, and welcome email delivery.
- Validation: `bun run check` passed with 84 unit tests across 25 suites and a successful build.

- 2026-07-17: Restored local authentication by creating and migrating the configured `ajocloud`
  development database, corrected the Ajo seed capacity invariant, and enabled development-only
  pretty Pino output without changing structured production logging.

## 2026-07-17 — Brevo transactional email and SMS

- Installed `@getbrevo/brevo` 6.0.2 and implemented typed API clients for transactional email and
  SMS using verified official v6 SDK contracts.
- Replaced the Brevo email stub and auth-only mock SMS branch with replaceable email/SMS provider
  adapters selected through strict environment validation.
- Added a versioned, HTML-escaped template catalog for email verification, welcome, password reset,
  password change, login alerts, Ajo contribution/payout, Food Ajo distribution, Akawo progress, and
  Bill Payment receipts, plus verification/password-reset SMS.
- Centralized delivery persistence, deterministic dedupe, safe payload storage, provider message IDs,
  and generic failure recording. OTPs and raw provider errors are not persisted.
- Connected phone/email verification and post-activation welcome delivery. Templates for product
  events remain unconnected until those domain event workflows exist.
- Local configuration uses the account's active verified email sender and an `AjoCloud` SMS Sender
  ID; production still requires sender-domain/SMS approval and secret-manager rotation.
- Validation: `bun run check` passed with 83 unit tests across 24 suites and a successful build; E2E
  passed; the application booted cleanly with both Brevo providers selected; Brevo account/sender
  authentication and SMTP relay port `587` were verified without dispatching a live message.
- Production dependency audit found no high/critical issues. Three unrelated moderate advisories
  remain in Swagger static assets and Prisma development tooling.

## 2026-07-17 — Local environment and API documentation setup

- Completed the ignored local backend environment with host-reachable PostgreSQL, Redis, and
  RabbitMQ URLs, strong development-only token secrets, mock external providers, LAN binding, and
  Swagger enabled.
- Mounted the interactive OpenAPI explorer at `/docs` while keeping application endpoints under
  `/api/v1`, and added the Fastify static-assets dependency required to serve Swagger UI.
- Imported the authentication module into each protected feature module that uses the exported
  access-token guard, resolving the startup-time `JwtService` dependency error.
- Made Redis shutdown a no-op for a never-connected lazy client and a direct disconnect for
  non-ready transitional states.
- Configured the ignored Expo `.env.local` to call this workstation over its current LAN address.
- Validation: backend `bun run check` passed with 62 unit tests and a successful build; backend E2E
  passed; mobile `bun run validate` passed with 24 tests; live `/docs`, `/docs-json`, and liveness
  probes returned `200` over the LAN.
- Follow-up: connected the backend to the locally installed Homebrew RabbitMQ broker using its
  loopback-only development account; AMQP port `5672`, an authenticated channel handshake, and the
  management UI on port `15672` were verified. Aggregate readiness remains blocked by the missing
  PostgreSQL `ajocloud` database, not RabbitMQ.

## 2026-07-16 — Mobile wallet and Akawo schedule support

- Financial core: added owner-scoped posted-ledger wallet summary and recent activity APIs for the
  mobile Wallet phase. Balances derive from available/reserved ledger accounts; no stored or mocked
  balance is trusted.
- Akawo: added owner-scoped future schedule creation for active goals. Schedule execution and
  ledger-backed manual deposits remain explicitly incomplete.
- Seeds/tests: added a balanced posted opening-wallet transaction and pending Akawo schedule; unit
  coverage verifies balance derivation, cross-owner denial, schedule serialization, and past-date
  rejection.
- Roadmap: Phase 2 received its wallet read extension and Phase 6 now has one task in progress;
  completion remains 61/122 (50%).

## 2026-07-16 — Food programme and Akawo read/create APIs

- Roadmap: completed approved-coordinator Food Ajo programme creation, flexible Akawo goal service,
  and target Akawo progress/statements; total roadmap completion is 61/122 (50%).
- Food Ajo: authenticated list/detail plus serializable draft creation with nested packages/items,
  active coordinator-approval enforcement, validation, audit, and outbox event.
- Akawo: owner-scoped flexible/target creation/list/detail, successful-contribution aggregation,
  basis-point progress, and cursor-paginated statements. Locked goals and all money movement fail
  closed or remain absent.
- Seeds/tests: realistic approved coordinator, Food plan/package/items, and active target goal;
  service tests cover coordinator denial/atomic writes and Akawo policy/progress.

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
