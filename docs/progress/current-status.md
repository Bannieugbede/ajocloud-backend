# Current status

- Last updated: 2026-08-07
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

The real Monnify Bill Payment adapter/webhook and real Monnify/Dojah KYC adapters are blocked by absent verified provider contracts. Multiple Ajo payout recipients/default handling, the ambiguous referral “#5” rule, and production fee limits require product/compliance decisions. Brevo production approval still requires compliance, sender-domain/SMS Sender ID, and webhook decisions. Docker is unavailable, but PostgreSQL 18 from Postgres.app was used to apply both migrations and run transaction tests.

## Next recommended tasks

1. Add service-level PostgreSQL concurrency/replay tests for group locking/swaps and the complete Bill Payment orchestration.
2. Implement scheduled provider inquiry plus durable outbox relay/inbox consumers and notification workers.
3. Obtain and review current Monnify/Dojah specifications and commercial terms before implementing real adapters or webhooks.
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
