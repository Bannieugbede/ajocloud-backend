# Current status

- Last updated: 2026-09-01
- Current phase: Financial-core hardening plus staged Traditional Ajo, Food Coordinator, and Bill Payment delivery, with an admin read API layer serving the web admin dashboard

## Complete

Foundation bootstrap/infrastructure/docs; auth/session rotation; email-only account verification;
versioned registration consent and verification delivery records; live permissions; users/profile;
wallet ownership reads; append-only ledger posting/reversal; audit/idempotency; Docker/CI; fixed and
flexible whole-unit Ajo creation/locking/calendars/versioned swaps; versioned fee snapshots; Food
Coordinator application/review/approval/suspension; provider-neutral Bill Payment catalog/validation/
reservation/payment/manual reconciliation/provider reversal/receipt; KYC tier/provider boundaries;
configurable referral and notification policies; Brevo transactional email/SMS adapters; versioned
welcome, authentication, security, and product notification templates; Akawo schema expansion; and
public brand configuration.
Approved-coordinator Food Ajo programme creation/reads; Akawo flexible/target goal creation,
owner-scoped progress, and paginated contribution statements. Owner-scoped wallet balance/activity
reads and Akawo future schedule creation are also implemented.

An admin read API layer (permission-gated under `/api/v1/admin`) backs the web admin dashboard:
platform overview KPIs (users, active groups, 30-day ledger volume and fee collections), paginated
user/group/goal/Food Ajo/bill-payment/ledger/KYC/coordinator listings, per-user and per-group detail,
versioned fee definitions, and platform settings (brand configuration, roles, fee count). A
deterministic admin demo seed populates all of these surfaces locally.

A public engagement API (`/api/v1/engagement/waitlist` and `/api/v1/engagement/support-inquiries`)
captures pre-launch waitlist sign-ups (names, email, `+234` phone, promotion opt-in) and visitor
support inquiries. Admins review both through dedicated read endpoints and the web admin console.

## In progress

Akawo auto-save is **IN PROGRESS**: authenticated users can create future schedules for their own
active goals. Notification event coverage is **IN PROGRESS**: verification and welcome are wired;
other template families await their domain events. Durable Akawo execution and ledger-backed
deposits remain outstanding.

## Blocked

The real Monnify Bill Payment adapter/webhook remains blocked by absent verified provider contracts. Monnify is now the single payments, verification, and payout provider (ADR-005); its identity adapter is implemented but its endpoint paths are unconfirmed against a live account. Multiple Ajo payout recipients/default handling and the ambiguous referral “#5” rule still require product/compliance decisions. The commercial fee model was decided on 2026-09-01 (pass-through charges; see “Fee model” below), but it is **not implementable against the current schema**: `FeeDefinition` supports only `FIXED` and `PERCENTAGE` with a min/max clamp, and the decided model is a step function over transaction bands. A tier concept and the inclusive/exclusive boundary wording must be settled before any fee code is written. Brevo production approval still requires compliance, sender-domain/SMS Sender ID, and webhook decisions. Docker is unavailable, but PostgreSQL 18 from Postgres.app was used to apply both migrations and run transaction tests.

## Fee model (decided 2026-09-01)

Charges are passed to users. Withdrawals: +₦10 per withdrawal, plus ₦50 on transactions up to
₦100,000. Deposits: ₦50 up to ₦10,000; ₦100 from ₦10,000; ₦150 from ₦200,000; ₦200 from
₦500,000. All figures exclude Monnify's own charges.

Two things block implementation:

1. **The schema cannot express it.** `FeeDefinition` (`prisma/models/fees.prisma`) has
   `calculationType` of `FIXED` or `PERCENTAGE` plus `minimumMinor`/`maximumMinor`. A banded step
   function is neither. The recommended change is a `FeeTier` model
   (`feeDefinitionId`, `fromMinor`, `toMinor`, `amountMinor`, ordered, validated non-overlapping and
   gap-free) plus a `TIERED` calculation type, which preserves the existing versioning and the
   rule-snapshot audit trail in `src/modules/fees/domain/fee-rule.ts`.
2. **Band boundaries are ambiguous.** The source brief says “up to ₦10,000” and then “from
   ₦10,000”, which overlap at exactly ₦10,000. Every boundary must be stated as inclusive or
   exclusive before implementation; an off-by-one at a band edge is a money bug.

There is currently no `FeesModule`, controller, service, or seeded definition — only the domain
function and its spec.

## Next recommended tasks

1. Add service-level PostgreSQL concurrency/replay tests for group locking/swaps and the complete Bill Payment orchestration.
2. Implement scheduled provider inquiry plus durable outbox relay/inbox consumers and notification workers.
3. Obtain and review current Monnify specifications and commercial terms before enabling real adapters or webhooks, and confirm the identity endpoint paths in `src/infrastructure/external-services/monnify/README.md`.
4. Approve Ajo default/multiple-recipient rules and the referral qualification ambiguity.
5. Implement Food Ajo activation/price locking and subscriptions, plus Akawo schedule execution,
   ledger-backed deposits, and withdrawals.

## Unresolved decisions and risks

See ADR-001/002/003 and all open questions. Primary risks are absent provider verification, incomplete
service-level concurrency/replay coverage, manual rather than scheduled Bill Payment reconciliation,
no verified webhook intake, no rate-limit Redis storage, no password recovery/device/MFA APIs,
production Brevo delivery still requiring operational/compliance approval and webhook intake, and schema-only
portions of Food Ajo, Akawo, KYC, referrals, and notifications.

## Verification and migrations

Local development configuration now includes the complete required environment contract, binds the
API to the LAN, and exposes interactive Swagger documentation at `/docs` for endpoint testing.
Redis and the Homebrew RabbitMQ broker are reachable locally. RabbitMQ uses its loopback-only
development `guest` account and exposes the management UI at `http://localhost:15672`. PostgreSQL
is running; the configured `ajocloud` database has been created and all three committed migrations
have been applied. Development registration and login were verified directly against the running
API. Local API logs use readable development formatting while test and production retain JSON.

Current `bun run check` passed: Prisma validation/generation, formatting, lint, strict typecheck,
84 unit tests across 25 suites, and build. E2E passed 1 test. Brevo account authentication, the
configured active sender, and SMTP relay reachability were verified without sending a live message.
All three migrations are now applied to the local PostgreSQL 18 `ajocloud` database. The corrected
development seed executes against that migrated database.
`bun audit --production` reports no high/critical findings and three unrelated moderate advisories:
two in the Swagger static-asset dependency and one Prisma development transitive dependency.

## 2026-08-19 — Transaction PIN and registration contract change

`POST /auth/register` now requires `phone` in E.164 format and accepts an optional `referralCode`;
`acceptedTerms` was removed so sign-up collects Privacy Policy consent only, against an explicit
`PRIVACY_POLICY_VERSION`. This is a breaking change for any client sending the old body — the
mobile app was updated in the same pass.

Transaction PIN added: `transaction_pins` table (migration `20260819160000_transaction_pin`), an
Argon2id-hashed digest, five-failure/15-minute lockout, and a refusal of predictable PINs.
Replacing a PIN requires the current one. The PIN is never returned or logged.

`bun run check` passed: Prisma validation/generation, formatting, lint, strict typecheck, 171 unit
tests across 32 suites, and build.

Still outstanding: BVN/NIN verification, the Nigerian bank list, and account-name inquiry, all
needed by the mobile sign-up step form. These are BLOCKED on a KYC ADR covering provider choice and
required Tier 2 fields. The agreed constraint is that the raw identifier is never persisted — only
the masked value, result, and provider reference — per docs/kyc.md.

The production database remains unreachable (`/health/ready` returns 503), so none of this has been
exercised against the deployed API, and the requested seeding still cannot run.

## 2026-08-26 — Waitlist outcomes and staff invitations

The public waitlist no longer reports an error to someone already on the list: the API returns
`JOINED` or `ALREADY_JOINED` and the web form confirms the existing place. Two real faults were
behind the reports — `CsrfGuard` rejected the public POST whenever the visitor happened to hold a
session cookie for the same domain, and the client discarded the API's error envelope, so
validation, rate-limit, and offline failures all rendered as one generic string. Both are fixed;
public routes now opt out of CSRF explicitly via `@PublicEndpoint()`.

Staff invitations are implemented end to end: invite and revoke from `/admin/staff` behind a new
`staff.manage` permission, a 72-hour emailed link storing only the token's HMAC digest, and an
acceptance page that creates the account with its role and signs the person in. `SUPER_ADMIN` is
deliberately not invitable over email.

`bun run check` passed: Prisma validation/generation, formatting, lint, strict typecheck, 312 unit
tests across 44 suites, and build. The web app passes typecheck, lint, and build.

Not yet verified against a live database: Docker is unavailable in this environment, so
`20260826120000_staff_invites` has not been applied and the invite flow has not been exercised
against Postgres. Before the Staff page works in a deployed environment, set `ADMIN_WEB_URL` and
re-run the seed so `staff.manage` exists and is attached to the admin roles.
