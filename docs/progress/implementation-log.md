# Implementation log

## 2026-08-07 — Public engagement API (waitlist + support)

- Added a public `EngagementModule` under `/api/v1/engagement` with
  `POST /waitlist` and `POST /support-inquiries`, validated with class-validator DTOs including
  Nigerian mobile numbers in `+234` E.164 format.
- Added `WaitlistEntry` and `SupportInquiry` Prisma models (migration `20260807095001_waitlist_support`)
  with status-as-string for flexibility and indexes on status/createdAt; waitlist upserts on email.
- Exposed admin read endpoints `GET /admin/waitlist` and `GET /admin/support-inquiries`
  (permission `users.read`) with the shared paginated list shape.
- Seeded deterministic waitlist entries and support inquiries in the admin demo seeder.
- Validation: migration applied to the local `ajocloud` database, seed ran cleanly (5 waitlist,
  4 inquiries), `bun run check` passed.

## 2026-08-07 — Admin read API and demo seed

- Added an `AdminModule` exposing read-only, permission-gated endpoints under `/api/v1/admin` to
  power the web admin dashboard: overview KPIs (total users, active groups, 30-day user growth,
  posted ledger volume, collected fees), paginated lists for users, Ajo groups, Akawo goals,
  Food Ajo programmes, bill payments, ledger transactions, KYC profiles, and coordinator
  applications, plus user/group detail, fee definitions, and platform settings.
- Endpoints reuse the existing `AccessTokenGuard` and `PermissionsGuard` with scoped permissions
  (`users.read`, `ajo.manage`, `kyc.review`, `bill-payments.reconcile`, `fees.manage`, `audit.read`).
- Added an idempotent `admin-demo` seeder that creates a realistic admin persona plus members,
  verified KYC profiles, wallets with opening balances, locked Ajo groups with cycles, Akawo goals,
  Food Ajo programmes, bill payments, fee definitions, roles, and brand configuration.
- Validation: `bun run check` passed with 84 unit tests across 25 suites and a successful build;
  the admin seed executed cleanly against the local PostgreSQL database and is repeatable.

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

## 2026-08-19 — Transaction PIN, registration fields, privacy-only consent

- Scope: back the mobile account-creation step form. Registration contract widened; transaction PIN added end to end.
- Files: `prisma/models/identity.prisma` (`TransactionPin`), `prisma/migrations/20260819160000_transaction_pin/`, `src/modules/auth/domain/transaction-pin-policy.ts`, `src/modules/auth/transaction-pin.service.ts`, `src/modules/auth/dto/transaction-pin.dto.ts`, `src/modules/auth/dto/register.dto.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`.
- Tests: 27 new (12 policy, 15 service) covering shape and weak-PIN rules, lockout thresholds and expiry, refusal while locked without spending an attempt, replacement requiring the current PIN, and an assertion that the PIN appears nowhere in the payload handed to the database.
- Decisions: PIN hashed with Argon2id at the password parameters; five consecutive failures lock for 15 minutes; predictable PINs refused because a four-digit space is small; replacement requires the current PIN so a hijacked session cannot lock the owner out.
- Breaking: `POST /auth/register` requires `phone` (E.164) and no longer accepts `acceptedTerms`; consent is Privacy Policy only, versioned via `PRIVACY_POLICY_VERSION`. `referralCode` is optional and recorded on the registration audit entry rather than resolved at sign-up, since referral qualification is a campaign rule.
- Quality: `bun run check` passed — Prisma validate/generate, format, lint, strict typecheck, 171 unit tests across 32 suites, build.
- Remaining: BVN/NIN verification, Nigerian bank list, and account-name inquiry are BLOCKED on a KYC ADR. Nothing verified against the deployed API: the production database is still unreachable.

## 2026-08-26 — Waitlist outcome reporting and staff invitations

- Scope: two user-reported gaps. Joining the waitlist surfaced an error to people already on it, and there was no way to give a colleague admin access.
- Waitlist: `EngagementService.joinWaitlist` now reports `JOINED` or `ALREADY_JOINED` with the original `joinedAt`, so a repeat submission confirms the existing place instead of reading as a failure. The upsert still refreshes contact details, so a typo'd phone can be corrected without losing position.
- CSRF: `POST /engagement/*` carried no CSRF header but was subject to `CsrfGuard`, which rejects any cookie-bearing write. A visitor already signed in on the domain therefore got a 403 from a public form that never consults their session. Added `@PublicEndpoint()`, honoured by the guard, and applied it to both engagement routes.
- Error surfacing: the web client now reads the API's `error.message` envelope, takes the first validation message, and falls back to a plain sentence per status (offline, 429, 5xx). Engagement DTO messages were rewritten for the person filling in the form, since the client renders them verbatim.
- Staff invites: new `StaffInvite` model and `20260826120000_staff_invites` migration; `StaffInviteService` in a standalone `StaffModule` so admin (issuing) and auth (redeeming) both depend on it without importing each other. `POST /admin/staff/invites` behind a new `staff.manage` permission, plus list/revoke and a roles endpoint; `GET /auth/staff-invite` and `POST /auth/staff-invite/accept` are public because the invitee has no account yet. Accepting creates the user, credential, profile, and role assignment in one serializable transaction, then issues a session.
- Security decisions: only the token's HMAC digest is stored, so an outstanding invite cannot be redeemed from a database dump. `SUPER_ADMIN` is not invitable — the highest privilege should not be one leaked mailbox away. Preview and accept report every failure identically, so a guessed token cannot distinguish a revoked invite from an unknown one. A partial unique index keeps at most one PENDING invite per address; the transaction re-reads status so two tabs cannot both create an account. Redeeming a link sent to the mailbox is treated as email verification, matching the password-reset flow.
- Web: `/admin/staff` (list, invite dialog, revoke) and `/invite` for acceptance. The accept page sits outside `/admin` deliberately — that layout redirects anyone without a session to sign-in, which is every invitee until they accept.
- Files: `prisma/models/staff-invites.prisma`, `prisma/migrations/20260826120000_staff_invites/`, `src/modules/admin/staff/*`, `src/modules/admin/dto/staff-invite.dto.ts`, `src/common/decorators/public-endpoint.decorator.ts`, `src/modules/auth/guards/csrf.guard.ts`, `src/modules/engagement/*`, `src/config/env.schema.ts` (`ADMIN_WEB_URL`), and the web waitlist/admin/invite surfaces.
- Tests: 20 new (4 engagement outcome, 15 staff invite covering digest-only storage, expiry, revocation, double-open, and indistinguishable failures, 1 CSRF public-endpoint exemption).
- Quality: `bun run check` passed — Prisma validate/generate, format, lint, strict typecheck, 312 unit tests across 44 suites, build. Web: typecheck, lint (0 errors), and `next build` passed. Verified the Nest graph resolves and all six routes register; confirmed the hand-written migration matches Prisma's canonical DDL.
- Remaining: not exercised against a live database — Docker is unavailable in this environment, so the migration has not been applied and the flow has not been run end to end against Postgres. `ADMIN_WEB_URL` must be set in each deployed environment, and the seed must be re-run (or `staff.manage` granted) before the Staff page is reachable.

## 2026-09-01 — KYC compliance decision workflow

- Scope: Phase 4's first item. The admin console could list KYC profiles but not act on them — every `/admin` route was a `@Get` except staff invites, notifications, and profile. A compliance officer had a queue and no verdict.
- Domain: `src/modules/kyc/domain/kyc-review-policy.ts` holds the rules as pure functions — which statuses are reviewable, what each decision does to the profile, how the decision is recorded on the review row, and which tiers the passed checks actually evidence. Keeping them out of the service made the tier rule testable without a database.
- Service: `KycReviewService` runs each decision as one serializable transaction that updates the profile, closes the open `ComplianceReview`, and writes both an audit entry and an outbox event. When no review is open it creates one, so a decision is never recorded without its row.
- API: `GET /admin/kyc-profiles` (queue, oldest submission first) and `GET /admin/kyc-profiles/:id` (evidence), plus `POST /:id/approve`, `/reject`, `/request-information`, and `/escalate`. All behind the existing `kyc.review` permission, already granted to `COMPLIANCE_OFFICER` in the seed, so no permission changes were needed.
- Decisions: the granted tier is an explicit request field rather than inferred, so a reviewer states what they intend to unlock and the service can refuse it — Tier 2 needs a passed BVN/NIN/vNIN check, Tier 3 additionally needs a passed bank check, because Tier 3 gates coordinator approval and high-value movement. A settled profile (`VERIFIED`, `REJECTED`, `NOT_STARTED`) cannot be re-decided: overwriting silently would erase the earlier decision's reasoning from the audit trail. Every non-approval requires a reason, since it reaches the applicant and is the compliance record. Escalation and an information request both leave the profile `REQUIRES_REVIEW`, so the distinction is carried on the review row (`ESCALATED` vs `CLOSED`) rather than lost.
- Privacy: the reviewer reads masked identifiers and results only. No raw identity number is selected anywhere in this module, consistent with `docs/kyc.md` and ADR-004 — `KycService` never persisted one to begin with.
- Files: `src/modules/kyc/domain/kyc-review-policy.ts`, `src/modules/kyc/kyc-review.service.ts`, `src/modules/kyc/admin-kyc-review.controller.ts`, `src/modules/kyc/dto/review-kyc-profile.dto.ts`, `src/modules/kyc/kyc.module.ts`.
- Tests: 18 new (9 policy, 9 service) covering tier evidence, refusal to re-decide a settled profile, the escalate/request-information distinction, that a refused decision writes nothing at all, and that a non-approval never sets `verifiedAt`.
- Quality: format, lint, strict typecheck, build, and 342 unit tests across 47 suites passed. `prisma format --check` reports pre-existing drift in `prisma/models/` that predates this change; reformatting was deliberately left out to keep the diff focused.
- Remaining: no schema or migration was needed — `ComplianceReview` already modelled this. Not exercised against a live database; Docker is unavailable here, so the transaction behaviour has unit coverage but no PostgreSQL integration test. The admin console UI for these actions is not yet built, so the endpoints exist without a caller.
