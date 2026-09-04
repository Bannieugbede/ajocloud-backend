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

## 2026-09-02 — Food Ajo coordinator tooling: lifecycle, procurement, and distribution

- Scope: the three Phase 5 gaps that left a created programme inert. A coordinator could create a draft and nothing else — there was no way to open it for enrolment, no procurement service at all, and the `PurchaseOrder`, `PurchaseReceipt`, `FoodDistribution`, and `DistributionConfirmation` models had existed since the initial schema with no code touching them.
- Domain: extended `src/modules/food-ajo/domain/food-ajo-policy.ts` with the programme, purchase-order, and distribution transition tables, the price-lock and procurement guards, and the collection-code helpers. Kept free of Prisma and Nest, so every rule below is tested without a database.
- Service: `FoodAjoCoordinatorService`, separate from `FoodAjoProgrammesService` because the two have opposite authorization — every route here is owner-scoped to the coordinator of that specific programme, and none may be reached by a subscriber. Ownership is checked against the programme record rather than a role, since coordinating one programme must not confer control of another; a non-coordinator is told the programme was not found, so the routes cannot be used to probe for existence.
- Price lock: opening a programme (`DRAFT → OPEN`) stamps `priceLockedAt` on every unlocked package, and a locked package is then refused for edit. The lock is taken at opening rather than at creation because a draft is still being worked on and has no members to protect; once a price is displayed, a member has enrolled against it, and changing it would alter what somebody already agreed to pay. `priceLockedAt` had existed in the schema with nothing setting it.
- Procurement: sized by portions actually enrolled, never by capacity — ordering to capacity would spend contributions that were never collected on food nobody claimed. Refused until the programme is `ACTIVE`, so the subscriber list can no longer change underneath the order. Totals are computed server-side from the line items, scaling decimal quantities through integers (`scaleByQuantity`) so a quantity such as `2.5` cannot introduce float drift; rounding is half-up so the vendor is not systematically underpaid. Orders are restricted to verified vendors, and a coordinator-proposed vendor is created unverified on purpose so a coordinator cannot approve their own supplier and then order from it. A confirmed order cannot be cancelled — the vendor has committed — and cannot be marked fulfilled until a receipt exists, so the claim that goods arrived always has evidence behind it.
- Distribution: item lists are built server-side from the live subscriptions rather than accepted from the client, so a coordinator cannot quietly omit a member who paid. Neither a distribution nor the programme can be completed while any member's item is unconfirmed — closing with outstanding items would erase the record that somebody never received what they paid for.
- Collection evidence: the one-time code is issued to the **member**, not the coordinator. A coordinator able to both mint and redeem a code could record food as collected that nobody ever received, which is exactly what this evidence exists to rule out. Six characters from an alphabet excluding ambiguous glyphs (it is read aloud in a queue and typed by hand), returned once, stored only as a SHA-256 digest, expiring after 30 minutes and burnt on use so a screenshot cannot be replayed. Re-issuing replaces the previous code so a member who lost theirs is not locked out. A wrong code and an expired one are reported identically, so the endpoint cannot be used to probe for live codes.
- Files: `src/modules/food-ajo/domain/food-ajo-policy.ts`, `src/modules/food-ajo/food-ajo-coordinator.service.ts`, `src/modules/food-ajo/food-ajo-coordinator.controller.ts`, `src/modules/food-ajo/dto/coordinator.dto.ts`, `src/modules/food-ajo/food-ajo.module.ts`, `docs/food-ajo.md`.
- Tests: 62 new unit tests (34 policy, 28 service), 88 across the module, plus a 13-test PostgreSQL integration spec (`test/food-ajo-coordinator.integration-spec.ts`, gated behind `RUN_DATABASE_INTEGRATION`). Mutation-tested the four security guarantees: removing the ownership check, skipping the receipt requirement before fulfilment, storing the collection code in the clear, and not burning the code on use each caused a test to fail.
- Schema: none. Every model this uses already existed; the gap was entirely in the service layer.
- Verified against live PostgreSQL: all 14 migrations applied to a scratch database, and the whole coordinator flow was exercised end to end — ownership hiding, price locking at open, a procurement plan sized at 4 portions out of 50 places, an order totalled to ₦42,000 from a fractional quantity, fulfilment refused until a receipt existed, a member-issued code stored as a 64-character digest that differed from the code returned, replay refused after use, and a completed programme refusing to reopen. The scratch database was dropped afterwards.
- Bug found while re-reading: `activatedAt` was rewritten every time a suspended programme resumed, contradicting its own comment. It is now stamped only when unset, with two tests covering first activation and resume.
- Quality: format, lint (0 warnings), strict typecheck, and 551 unit tests across 55 suites passed. One auth spec times out under parallel `jest` because argon2 is deliberately slow; it passes in isolation and under `--runInBand`, which is what the project's own `test` script uses. Build was not run, per the standing instruction in this session.
- Remaining: contributions are still not collected against a programme — the `FOOD_SUBSCRIPTION` payment target exists but no route settles one, so the procurement plan's expected amount is what members owe rather than what has been received. Vendor _approval_ is admin work and is not built, so verified vendors currently only arrive via the seed or direct SQL. Coordinator suspension/revocation, automated KYC/risk/bank checks, and missing-item disputes remain outstanding. No mobile or web surface calls any of these routes yet.

## 2026-09-02 — Ajo swap listing and notification preferences

- Scope: two features whose backing pieces existed but were unreachable. Swap approve/reject had been implemented and routed, but nothing listed a pending swap, so a request could only be acted on by a caller who already knew its id — approvals were effectively dead. `NotificationPreference` had sat in the schema with quiet hours and per-topic toggles, seeded once and read by nothing, and `isWithinQuietHours` was a tested function no code called.
- Swap listing: `GET /api/v1/ajo-groups/:groupId/swaps` returns each request with both positions named and `awaitingMyDecision`. That flag is computed server-side because it depends on who owns the two affected slots; a client re-deriving it could disagree with what the approve route will accept. An elapsed request is reported as `EXPIRED` even before the row is rewritten, so the list never invites a decision that would be refused. Only display names are exposed — `AjoGroupMember` carries no `User` relation, so names are read through `UserProfile`, and no email is selected anywhere.
- Notification topics: a closed catalogue in `notification-topics.ts` rather than free text, because `topic` is a plain string column and a client typo would otherwise store a row that looks saved and governs nothing. Every template maps to a topic or to the always-send set, and `topicForTemplate` throws for anything unmapped. A test reads the template union from source, so a template added without a topic fails there rather than in production.
- Security messages are always sent: verification, sign-in codes, password reset and change, login alerts, device additions, account locks, and staff invites carry no topic, bypass quiet hours, and are absent from the catalogue. Someone who had switched off reset mail could not recover their account, a login alert eight hours late is not an alert, and a switch that does nothing is worse than none.
- Suppression writes no `Notification` row. The record describes delivery and a message never attempted has none; storing one would also consume the dedupe key, so a later permitted send of the same event would be swallowed as a duplicate. `SUPPRESSED` is reported distinctly from `FAILED` so a caller does not retry something that did not fail — the compiler caught the one existing caller that assumed two outcomes.
- Quiet hours are evaluated in the user's own timezone through `Intl`, so DST and any future offset change come from the platform tz database rather than a hardcoded offset. Both ends of a window are written together; one end alone describes no window and is rejected.
- Module wiring: the preferences controller lives in its own `NotificationPreferencesModule`, because `AuthModule` already imports `NotificationsModule` to send verification mail and importing it back would have created the module cycle AGENTS.md forbids.
- Mobile: `/(tabs)/ajo/[groupId]/swaps` and `/(tabs)/profile/notifications`. The group screen shows how many swaps need this member, so they do not have to open the screen to find out. Decision buttons are withdrawn once a deadline passes, mirroring the server rule rather than only checking status. The settings screen collapses the topic-by-channel grid into one row per topic — a person thinks "tell me about payouts", then picks how — and shows "Off" rather than guessing when stored windows disagree, since applying one row's window to everything on save would change settings nobody touched.
- Files: `src/modules/notifications/domain/notification-topics.ts`, `notification-policy.ts`, `notification-preferences.{service,controller}.ts`, `notification-preferences.module.ts`, `dto/notification-preference.dto.ts`, `transactional-notification.service.ts`, `src/modules/ajo-groups/ajo-swaps.service.ts`, `ajo-groups.controller.ts`, `src/common/testing/mock-arguments.ts`, `src/modules/admin/staff/staff-invite.service.ts`.
- Tests: 44 new backend (16 policy, 6 topics, 9 preferences service, 9 swap listing, 4 send-path suppression), 593 across 58 suites. Mobile: 45 new (16 settings logic, 16 swap logic, 13 screens), 345 across 36 suites. Mutation-tested both notification guarantees — making `password-reset` suppressible and removing the suppression short-circuit each broke tests.
- Quality: format, lint (0 warnings), strict typecheck, and the full suites passed on both repos; mobile `validate` includes terminology. Build was not run, per the standing instruction in this session.
- Remaining: nothing yet _emits_ the product notifications these preferences govern — the templates and the gate exist, but only verification, welcome, reset, and staff invites are wired to domain events, and all of those are always-send. So the preference screen is correct and enforced, but currently governs messages the platform does not send. PUSH and IN_APP are deliberately not offered for the same reason.

## 2026-09-03 — Tiered platform fees and deposit settlement

- Scope: the two blockers that stopped money entering the platform. Fees were undecided, so `feeFor` returned `0n`; webhook ledger posting had no account mapping, so a verified successful transfer credited nothing. Every development balance came from a seeder.
- **The recorded pricing was loss-making.** The 2026-09-01 flat bands (₦50 up to ₦10,000, ₦100 above) charge less than a 1.5% provider rate costs on any deposit above roughly ₦3,300: a ₦50,000 deposit would have cost ₦750 and charged ₦100, and the loss grew with the deposit. This was found by checking the arithmetic against the provider rate rather than by implementing what was written. ADR-009 supersedes it.
- Fee model (ADR-009): `charge = max(percentage, providerCost + tieredMarkup)`. Taking the greater means the platform never sells below cost, while margin still scales with the amount. Reproduces the modelled cases exactly — ₦1,000 charges ₦65 for ₦50 margin, ₦15,000 charges ₦325 for ₦100. Payouts are the provider's flat transfer cost plus ₦5, because outbound pricing is per transaction rather than proportional.
- Band boundaries are half-open (`fromMinor <= amount < toMinor`), so a deposit of exactly ₦10,000 pays the upper markup and no threshold is ambiguous. `assertTiersPartitionRange` refuses any tier set with a gap or an overlap, and it runs during assessment rather than being merely available — a gap would leave an amount with no fee, and an overlap would make the fee depend on row order.
- Provider rates are seeded, versioned configuration rather than constants. No Monnify pricing is documented in this repository, so the 1.5% and ₦20 figures are commercial modelling assumptions; storing them as data means correcting them is a seed change with an audit trail, and `FeeAssessment.ruleSnapshot` records which version applied.
- Settlement (ADR-010): a successful transaction debits `PROVIDER_PAYABLE` gross, credits `WALLET_AVAILABLE` net of the fee, and credits `PLATFORM_FEE_REVENUE`. The fee is netted rather than charged separately because the user sent one amount and there is no second opportunity to collect — a separate fee debit could fail against an empty wallet and leave the ledger describing a fee never taken. The zero-fee case omits the third leg rather than posting an empty row.
- Exactly-once is guarded twice: `PaymentWebhookEvent` is unique per provider event, and the ledger key is derived from the intent, so a same-payment event redelivered under a new event id still cannot post twice. A duplicate credit is unrecoverable once spent.
- The settlement never recomputes the fee. `PaymentIntent.feeMinor` is what the user was quoted; re-deriving it at settlement could charge differently if a definition version changed in between.
- Wallet top-up is now creatable and is the one target that accepts a client amount, because it has no row to read one from. A source test pins that to a single line, so a second amount entry point cannot appear unnoticed. A `MINIMUM_DEPOSIT_MINOR` floor exists because cost-plus is regressive at tiny amounts (₦100 would be charged ₦51.50) — it is an engineering placeholder, not an approved commercial figure.
- Files: `docs/adr/ADR-009-platform-fee-model.md`, `docs/adr/ADR-010-webhook-ledger-posting.md`, `prisma/models/fees.prisma`, `prisma/models/core-enums.prisma`, `prisma/migrations/20260903090000_tiered_fees/`, `prisma/seed/seeders/fees.ts`, `src/modules/fees/*`, `src/modules/payments/payment-settlement.service.ts`, `payments.service.ts`, `dto/create-intent.dto.ts`, `domain/payment-policy.ts`, `src/modules/webhooks/monnify-webhooks.service.ts`.
- Tests: 613 unit across 59 suites, plus a 5-test PostgreSQL integration spec. Mutation-tested the three money guarantees — crediting gross instead of net, dropping the in-transaction status re-check, and keying idempotency off anything but the intent each broke tests. Also replaced a brittle source-regex test with a behavioural one proving the target is re-resolved inside the settlement transaction.
- Verified live: a ₦15,000 deposit priced at ₦325 credited exactly ₦14,675 to a real wallet, a redelivered webhook credited nothing further, and an unmatched reference posted nothing. Scratch database dropped afterwards.
- Remaining: Monnify's own adapter still is not wired, so nothing yet _calls_ Monnify to create the transfer — the settlement path is proven but its trigger is the mock provider. Payout execution debits the provider account in the other direction and is a separate workflow. Reversal posting stays blocked on fee refundability. The minimum deposit and the provider rates both need commercial confirmation.

## 2026-09-03 — Push, in-app notifications, and device registration

- Scope: two long-standing gaps. `Device` had existed since the initial schema with nothing writing to it, and `PUSH`/`IN_APP` were excluded from notification preferences because nothing delivered on them. Neither the app nor the platform knew what handsets an account used.
- Devices: `POST/GET/DELETE /api/v1/devices`. Registration is wired into the mobile app's single session-saving path, so no authentication route — password, OTP or Google — can forget to announce the device. A device is identified by an opaque fingerprint the app generates once and keeps in secure storage, deliberately not derived from hardware identifiers: those are restricted on both platforms, change across reinstalls anyway, and would make the record more identifying than it needs to be.
- **A device with no push token is still registered.** The record is what a security review of an account reads, and a device nobody knows about cannot be reviewed or signed out. Omitting the token on a later call leaves any stored one alone, so a registration made before permission resolves cannot wipe a working token.
- A push token identifies an installation, not a person. When the same token arrives under a different device or user — a restored backup, or a handset that changed hands — any older claim is released first; two rows holding one token would both look deliverable, and one would send another person's notifications to that phone. The token is never returned by the list route: it is an address for reaching the device, not something to show on a screen.
- Push provider: `ExpoPushProvider` posts to Expo's send endpoint in batches of at most 100, the documented limit. Expo answers with one ticket per token, so a batch is not all-or-nothing and one dead token cannot sink everyone else's notification. Only `DeviceNotRegistered` is treated as permanent and clears the stored token; every other failure keeps it, because dropping a live token would silently stop a working device from ever being reached again. Receipts are not polled — Expo advises checking about fifteen minutes later, which belongs to a worker rather than a request a user waits on.
- **The in-app entry is written even when push fails or no device is reachable.** Push is a prompt to open the app, not the notification itself; delivering only by push would mean someone who declined permission never learns their payout arrived. Title and body are rendered once at send time and stored, so the feed never re-renders a template whose version may since have changed and shows different words from the ones actually sent.
- Push payloads carry only a deep link. They travel through Apple's and Google's infrastructure and appear on a lock screen, so nothing sensitive belongs in them. The link is an in-app path, and the client refuses anything containing a scheme or outside its known route prefixes — a server-supplied link followed blindly is an open redirect.
- Short-form copy is a separate catalogue from the email templates, because a push body is read at a glance and an email body makes an impossible one. Security templates have no short-form entry on purpose: a push saying someone signed in is useful, but a recovery link must go to a mailbox an attacker does not already hold.
- Preferences now cover all four channels. SMS is included even though no hosted provider is selected, so those preferences are recorded and honoured but nothing sends on that channel today.
- Mobile: `expo-notifications` per the SDK 57 API — an Android channel created before requesting a token (required there), explicit `projectId` rather than relying on manifest inference, and the current `shouldShowBanner`/`shouldShowList` behaviour rather than the deprecated `shouldShowAlert`. Permission refusal and offline token fetches return null rather than throwing: being unreachable by push is an ordinary state, and registration never blocks a sign-in that already succeeded.
- Files: `prisma/models/identity.prisma`, `prisma/models/operations.prisma`, `prisma/migrations/20260903120000_push_notifications/`, `src/modules/devices/*`, `src/modules/notifications/providers/push-provider.ts`, `console-push.provider.ts`, `templates/push-templates.ts`, `notification-feed.{service,controller}.ts`, `src/infrastructure/external-services/expo/expo-push.provider.ts`, plus the mobile device/notification clients, push registration service, notification handler, and inbox screen.
- Tests: 657 backend across 63 suites (44 new: 11 device policy, 12 device service, 6 Expo provider, 7 notify path, 8 feed), and 366 mobile across 39 suites (21 new: 13 list and deep-link logic, 8 inbox screen). One of my own tests was timezone-dependent and failed on a UTC-literal fixture; rewritten with local-time constructors, since the labels are calendar-day based.
- Quality: format, lint, strict typecheck, and both full suites pass; mobile `validate` includes terminology. Build was not run, per the standing instruction in this session.
- Remaining: nothing yet emits these notifications. The delivery path, preferences, templates and inbox all work, but the domain events that would call `notify` — a payout sent, a contribution due, food ready — are not wired, so the inbox is empty in practice until they are. Expo receipts are not polled, so a token that fails after acceptance stays until its next send.

## 2026-09-03 — Group invitations and invitation links

- **The gap was issuance, not joining.** `GroupInvitation` was a complete model and `POST /ajo-groups/:groupId/join` already validated a code against it, incrementing `useCount` correctly. Nothing anywhere created a row. A group was therefore joinable only by someone who already held a code that no part of the system could produce.
- Issuing and redeeming hashed the code in two different files. The existing `join` used an unpeppered SHA-256; the natural implementation of issuance would have used HMAC like every other token in the codebase, and the two would silently never match — every invitation unredeemable, with both unit suites green. Both now call one `digestInvitationCode` helper, and an integration test mints a code through one service and redeems it through the other against real PostgreSQL, which is the only place that class of bug shows up. The digest was moved to peppered HMAC rather than left as a bare hash: the code alphabet is known, so a leaked table would otherwise be brute-forceable back into working links.
- **The public preview withholds the group id on purpose.** A link can be forwarded to anyone, so the anonymous endpoint returns what someone needs to decide whether to accept — group name, inviter, contribution, how full it is — and nothing addressable. The inviter's surname is abbreviated to an initial for the same reason: enough for a real invitee to recognise, not a full name handed to a stranger. A signed-in caller exchanges the code for the id through a separate authenticated route.
- Every unusable invitation is reported as `NotFound`, whatever is actually wrong with it, so a guessed code cannot distinguish a revoked invitation from one that never existed. Expiry and exhaustion are derived from the row's own fields rather than trusted from `status`, because nothing rewrites that column when a link simply ages out.
- Web: `/join/<code>` is `noindex, nofollow` — the path contains a secret. It attempts the custom scheme and stays put either way, because a browser cannot be asked whether an app exists; redirecting to a store would punish the person who already has it.
- **Universal links are configured but not enabled.** `apple-app-site-association` and `assetlinks.json` are in place with placeholder signing identifiers, and `associatedDomains`/`intentFilters` are deliberately absent from the mobile `app.json`: claiming the domain while the site serves a placeholder makes `https://` links fail silently, which is harder to diagnose than not claiming it. `docs/app-links.md` in the web repo records exactly what has to be filled in.
- Mobile: notification taps now navigate. `safeDeepLink` was written and tested in the previous change but nothing consumed it — tapping a notification opened the app on whatever screen it was already on. `useLastNotificationResponse` handles the cold-start tap, which is the common case and the one a render-time listener misses.
- My first link parser used `Linking.parse`, which is unavailable under `jest-expo`; all three positive cases failed. Rewritten as plain string work, since parsing a scheme URL is not worth a native dependency and this input is untrusted enough to deserve tests. A second pass tightened it: matching a `join` segment anywhere accepted `https://anyone.example/x/join/CODE`. Only the exact path position is honoured now, proven by mutation.
- Files: `src/modules/ajo-groups/{group-invitations.service,public-invitations.controller}.ts`, `domain/{group-invitation-policy,invitation-code}.ts`, `dto/create-group-invitation.dto.ts`, `test/group-invitations.integration-spec.ts`; web `src/app/join/[code]/page.tsx`, `src/components/join-invite.tsx`, `src/lib/invite-link.ts`, `public/.well-known/*`, `docs/app-links.md`; mobile `src/app/join/[code].tsx`, `src/features/ajo/invite-landing-screen.tsx`, `src/services/{incoming-link,pending-invitation}.ts`, `src/hooks/use-{incoming-invitation,notification-navigation}.ts`, `src/features/auth/post-sign-in-route.ts`.
- Tests: 704 backend across 66 suites (47 new), plus 8 live-PostgreSQL integration tests proving issue → preview → redeem and that a spent, revoked or expired code stops working. 389 mobile across 40 suites (23 new). Mutation testing confirmed the pepper and the path-position guard are both load-bearing. One integration test of mine was wrong rather than the code — the "stranger" fixture had joined the group in an earlier test, so it was asserting against a member.
- Quality: backend lint at `--max-warnings 0`, strict typecheck, and Prettier all clean; mobile `validate` green including terminology; web typecheck clean and lint free of errors. Build was not run, per the standing instruction in this session.
- Remaining: the invitation cannot yet be sent by the app on the member's behalf — the API returns a URL, but there is no share sheet or email behind it. Universal links need the two signing identifiers before `https://` invitations open the app.

## 2026-09-04 — Ajo contribution collection and payout execution

- **The rotation had nowhere to put money.** `Contribution` and `Payout` were complete models with no service behind them, and `ContributionSchedule`/`PayoutSchedule` were written at lock. So a locked group described obligations nobody could discharge and turns nobody could be paid. This is the core Ajo loop, and it was the largest remaining gap.
- ADR-011 records the rules, because they are financial ones and AGENTS.md requires an ADR for those. The constraint driving all of them is ADR-001: the platform "provides no liquidity float and never funds a shortfall".
- **Group money lives in a per-group pool account**, a new `AJO_GROUP_POOL` purpose. A liability, since the money belongs to the members, and deliberately not attached to a wallet — a group is not a person and must never acquire the withdraw or spend capabilities that hang off one. Rejected the simpler alternative of crediting the recipient's wallet as each contribution arrives: it makes a partly collected cycle indistinguishable from a complete one, and hands the recipient spendable money before the cycle is known to be solvent.
- **A payout requires the whole cycle collected, not merely enough to cover it.** Those differ: a pool can hold enough for this recipient while another member still owes, and paying then spends a later recipient's turn. A short cycle is HELD rather than failed, so settling the arrears lets it proceed with nothing re-created. Two guards deliberately — the schedule check is the business rule and could be wrong; the pool-balance check is the invariant and cannot be.
- No fee on either leg. The deposit already charged one (ADR-009), and ADR-001's arithmetic requires the recipient to get exactly `N x contribution`.
- **Two ordering bugs, both found by the live-database test and not by the unit tests.** Each was the same mistake in a different place: idempotency was checked _after_ validation that depends on state the first successful call had already changed. A retried payout hit "already settled" because its schedule now read PAID; a retried contribution hit "already paid in full" because `amountPaidMinor` had moved. Both now check idempotency first, and both have regression tests proven by mutation.
- A third defect from the same run: the HELD status was written inside the transaction that the subsequent throw rolled back, so a held payout silently stayed READY. The hold is now written after the rollback, through a marker error that carries its own HTTP shape.
- **Found by the type system, not by a test:** the mobile pay handler passed `slotId` where a `scheduleId` was required — different rows entirely. It had never worked, and could not have: the schedule endpoint did not return `id` at all, so nothing could reference a schedule to pay it. Both are fixed, and the stale assertion that encoded the old behaviour was updated rather than deleted.
- The mobile screen calls the new routes directly rather than the shared payment flow, whose `AJO_CONTRIBUTION` target still throws "this payment type is not available yet" server-side — routing through it would have taken a member to a dead end.
- Files: `docs/adr/ADR-011-ajo-contribution-and-payout-execution.md`, `src/modules/ajo-groups/ajo-settlement.service.ts`, `domain/ajo-settlement-policy.ts`, `dto/pay-contribution.dto.ts`, `prisma/models/core-enums.prisma`, `prisma/migrations/20260904100000_ajo_group_pool/`, `test/ajo-settlement.integration-spec.ts`; mobile `src/features/ajo/pay-contribution-screen.tsx`, `src/app/(tabs)/ajo/[groupId]/contribute.tsx`, `rotation.ts`.
- Tests: 80 new backend (41 policy, 39 service) plus 9 live-PostgreSQL integration tests covering the full loop — collect three contributions, refuse the payout while one is short, pay the whole pool once complete, and refuse to pay twice. Every posting is asserted balanced. 11 new mobile screen tests. Mutation testing confirmed five guards load-bearing: the wallet-balance check, the cycle-collected check, the pool-balance check, the deterministic payout key, and both idempotency orderings.
- Quality: backend lint at `--max-warnings 0`, strict typecheck and Prettier clean; mobile `validate` green at 400 tests including terminology. Build was not run, per the standing instruction in this session.
- Remaining: default handling beyond HELD — penalties, removing a defaulting member, redistributing a slot — needs its own ADR, because forfeiting someone's contributions is a rule about their money rather than an implementation detail. `PenaltyRule` exists and is still unused. Payout execution is a manual administrator action; nothing schedules it.
