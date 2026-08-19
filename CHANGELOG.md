# Changelog

## Unreleased

### Changed

- `POST /auth/register` now requires `phone` in E.164 format and accepts an optional `referralCode`
  (recorded on the registration audit entry for later attribution; whether it qualifies for a
  reward remains a campaign decision, not a sign-up one). `acceptedTerms` was removed: sign-up now
  collects Privacy Policy consent only, recorded against an explicit policy version.

### Added

- Tier 2 identity verification, settling steps g-i of the account-creation step form.
  `GET /kyc/status` reports what remains, `PATCH /kyc/personal-details` collects date of birth,
  gender, residential address, city, state, and occupation (refusing anyone under 18),
  `POST /kyc/identity` verifies a BVN or NIN, `GET /kyc/banks` serves the provider bank list,
  `POST /kyc/banks/inquire` resolves an account name, and `POST /kyc/bank-accounts` links the
  account once the name has been confirmed. Provider and data policy are set by
  [ADR-004](docs/adr/ADR-004-identity-verification-provider-and-data-policy.md).

  **Dojah** is the identity provider. Selection stays behind `KYC_PROVIDER`; anything other than
  `dojah` falls back to a mock that never reports a real-world identity as verified, so no
  environment can mistake a development pass for a genuine check.

  The raw BVN/NIN is **never persisted**. It is held for the life of one request, sent to the
  provider over TLS, and discarded; only the masked value (`*******1234`), the pass/fail result,
  the provider reference, and risk flags are written. Nothing — no log, audit payload, error
  message, or thrown exception — carries the full number, and transport errors are caught and
  replaced because the underlying error object can hold the request URL. Tests assert directly
  that no persisted or audited payload contains the identifier.

  Explicit consent is recorded as a `UserConsent` row before the provider is called, so there is
  no window in which a number was sent without a stored record of permission. A name mismatch
  against the profile raises a `NAME_MISMATCH` flag and routes the profile to review rather than
  auto-rejecting: Nigerian names vary legitimately in ordering, spelling, and diacritics, and an
  automatic reject on fuzzy comparison would exclude real users. Five failed checks per rolling
  24 hours then refuses further attempts and opens a compliance review, which bounds using the
  endpoint to enumerate identifiers.

  Linked bank account numbers are stored masked plus an HMAC digest keyed on the deployment
  pepper, so the same account is recognised across links without the number being recoverable
  from a database copy. The account name comes from the bank's inquiry, never from user input.
  New table: `linked_bank_accounts`; new columns on `user_profiles`; new `Gender` enum and
  `IDENTITY_VERIFICATION` consent type.

  Tier 3 (face match, liveness) remains unimplemented and needs a further ADR.

- Transaction PIN. `GET /auth/transaction-pin` reports whether one is set and any active lockout,
  `POST /auth/transaction-pin` sets or replaces it, and `POST /auth/transaction-pin/verify` checks
  it. The PIN is hashed with Argon2id on the same parameters as passwords and is never returned in
  a response or written to a log. Five consecutive failures lock the PIN for 15 minutes, and while
  locked even the correct PIN is refused. Replacing an existing PIN requires proving the current
  one, so a hijacked session cannot lock the owner out of their own money. Predictable PINs — a
  repeated digit, or a straight run in either direction — are refused outright, because a
  four-digit space is small enough that those are tried first. New table: `transaction_pins`.

- Password reset: `POST /auth/password-reset/request` issues a six-digit emailed code and
  `POST /auth/password-reset/complete` verifies it and sets the new password. The request endpoint
  always returns an identically shaped challenge — for unknown addresses, suspended accounts, and
  accounts with no password (e.g. Google-only) alike — so it cannot enumerate users. Completing a
  reset revokes every active session (`revokeReason: password_reset`) and marks the email verified.
  Attempt limits, expiry, and single-use consumption match the existing verification policy.
  New `VerificationPurpose.PASSWORD_RESET`.

- Google sign-in, shared by web and mobile. `GET /auth/google?client=web|mobile` redirects to
  Google's consent screen; `GET /auth/google/callback` exchanges the code, verifies the ID token's
  signature, audience, issuer, and expiry, then signs the user in. Web receives the session as
  httpOnly cookies and is redirected to `GOOGLE_WEB_SUCCESS_URL`; mobile receives a single-use,
  two-minute handoff code on its deep link and exchanges it via `POST /auth/google/exchange`, so
  tokens never appear in a URL. CSRF is covered by an HMAC-signed `state` parameter.
  A verified Google email auto-links to an existing account and completes its email verification;
  an unverified Google email is rejected. New accounts are created `ACTIVE` with no password.
  New tables: `user_identities`. New env (all optional; unset disables the provider):
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `GOOGLE_WEB_SUCCESS_URL`,
  `GOOGLE_MOBILE_SUCCESS_URL`.

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
