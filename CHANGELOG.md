# Changelog

## Unreleased

### Added

- Cookie-based browser sessions: `/auth/otp/verify`, `/auth/login`, `/auth/verify-email`, and
  `/auth/refresh` now set httpOnly `ajo_access` and `ajo_refresh` cookies (the refresh cookie is
  scoped to `/<prefix>/v1/auth`), plus a JS-readable `ajo_csrf` cookie for double-submit CSRF
  protection enforced by a global `CsrfGuard` on cookie-authenticated writes. `AccessTokenGuard`
  accepts either the cookie or the existing `Authorization: Bearer` header, so mobile and
  server-to-server clients are unaffected. New env: `SESSION_COOKIE_SAMESITE_NONE`,
  `SESSION_COOKIE_DOMAIN`, `COOKIE_SECRET` (all optional), and CORS now allows credentials.
- `CORS_ALLOW_LOOPBACK` accepts `http(s)://localhost|127.0.0.1|[::1]` on any port for local web
  development. Ignored when `NODE_ENV=production`.

- Public engagement API: `POST /api/v1/engagement/waitlist` (join the pre-launch waitlist with
  names, email, +234-normalized phone, and promotion opt-in) and
  `POST /api/v1/engagement/support-inquiries` (submit a support inquiry), backed by new
  `waitlist_entries` and `support_inquiries` tables with deterministic demo seed data.
- Admin read endpoints for waitlist entries and support inquiries under `/api/v1/admin`.
- Permission-gated admin read API under `/api/v1/admin`: platform overview KPIs, paginated
  user/Ajo-group/Akawo/Food-Ajo/bill-payment/ledger/KYC/coordinator listings, user and group detail,
  fee definitions, and platform settings.
- Deterministic admin demo seed (users, profiles, KYC, wallets, Ajo groups/cycles, Akawo goals,
  Food Ajo programmes, bill payments, ledger transactions, fees, roles, brand configuration)
  that is idempotent against the existing development seed.

- Official Brevo SDK integration for transactional email and SMS, including persisted delivery
  results, welcome/auth/security/product templates, and welcome delivery after account activation.
- LAN-ready local backend/mobile environment configuration and interactive API documentation at
  `/docs`.
- Correct authentication-guard dependency wiring for protected feature modules so the API can
  bootstrap successfully.
- Safe shutdown for a lazy Redis client that was never connected.
- Owner-scoped wallet available/reserved summary and recent posted-ledger activity APIs.
- Future Akawo savings schedule creation for active owner goals, with development seed records and
  service tests.

- Approved-coordinator Food Ajo draft programme creation and guarded programme list/detail APIs.
- Owner-scoped flexible and target Akawo goal creation, progress, detail, and paginated statement APIs.

- Email account verification with HMAC-only OTP challenges, resend/attempt limits, versioned
  registration consent, delivery/audit records, and a deterministic development persona.

- Fastify NestJS modular-monolith foundation with strict configuration, logging, security, health, API documentation, workers, and scheduler.
- Multi-file Prisma financial data model, environment-safe seeds, and initial migration.
- Rotating refresh-token authentication, scoped permissions, users, wallets, Traditional Ajo lifecycle/scheduling, ledger, audit, and idempotency foundations.
- Docker Compose, non-root production image, CI, tests, ADRs, roadmap, and operational documentation.
- Large-group fixed and flexible whole-unit Ajo rules, distinct member/slot counts, UTC contribution/payout calendars, immutable schedule versions, multi-party audited swaps, and versioned fee snapshots.
- Food Coordinator application, submission, compliance review, Tier-3-gated approval, information-request, rejection, and suspension APIs.
- Provider-neutral Bill Payment catalog/customer validation/payment flow with atomic wallet reserves, confirmed-failure release, uncertain-state reconciliation, provider reversal, immutable receipts, a deterministic mock, and an intentionally blocked Monnify adapter.
- Progressive KYC provider boundaries and tier policies; configurable referral qualification; notification templates/preferences/delivery records; generic email provider boundary; and public Ajo Cloud brand configuration.
- Additive product-scope migration, PostgreSQL financial integration tests, ADR-002/ADR-003, provider-reference notes, and expanded security/product documentation.

### Changed

- Transactional email now goes through Resend over its REST API, replacing the Brevo SDK. The
  `@getbrevo/brevo` dependency was removed; configure `EMAIL_PROVIDER=resend` with `RESEND_API_KEY`,
  `RESEND_SENDER_EMAIL`, and `RESEND_SENDER_NAME`.
- Brevo also provided SMS, so `SMS_PROVIDER` now accepts `mock` only. The `SmsProvider` boundary and
  the `SMS` notification channel are unchanged, so a replacement needs no schema migration.
- `PUSH_PROVIDER` accepts `mock` or `expo`; `PUSH_API_KEY` was removed because Expo needs no server
  key for tokens it issued.
- `DIRECT_DATABASE_URL` and `SMTP_URL` were removed; a single `DATABASE_URL` now configures Prisma.
- Account registration and activation now use one email verification challenge; phone collection,
  phone OTP delivery, and the public phone-verification endpoint were removed from the auth flow.
- Development API logs now use readable, colorized Pino formatting while production and test logs
  remain structured JSON.
- Corrected the development Ajo seed capacity so a fresh migrated database seeds completely.
- Standardized the canonical savings product spelling from `Akawa` to `Akawo` without renaming existing database tables.
- Expanded financial accounts with explicit available/reserved/provider-payable/fee purposes and registration-time wallet accounts.
