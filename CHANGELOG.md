# Changelog

## Unreleased

### Added

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

- Account registration and activation now use one email verification challenge; phone collection,
  phone OTP delivery, and the public phone-verification endpoint were removed from the auth flow.
- Development API logs now use readable, colorized Pino formatting while production and test logs
  remain structured JSON.
- Corrected the development Ajo seed capacity so a fresh migrated database seeds completely.
- Standardized the canonical savings product spelling from `Akawa` to `Akawo` without renaming existing database tables.
- Expanded financial accounts with explicit available/reserved/provider-payable/fee purposes and registration-time wallet accounts.
