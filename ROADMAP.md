# Ajo Cloud roadmap

Status labels: **COMPLETE**, **IN PROGRESS**, **BLOCKED**, **NOT STARTED**, **DEFERRED / POST-MVP**. Schema or interface work alone is not a completed product workflow. Every complete item has implementation, tests, authorization/security treatment, and documentation. Blockers and evidence live in [current status](docs/progress/current-status.md).

| Phase                          |   Total | Complete | In progress | Blocked | Completion |
| ------------------------------ | ------: | -------: | ----------: | ------: | ---------: |
| 0 Foundation                   |      14 |       14 |           0 |       0 |       100% |
| 1 Identity/security foundation |       8 |        7 |           0 |       0 |      87.5% |
| 2 Financial core               |      11 |        5 |           0 |       0 |      45.5% |
| 3 Traditional Ajo              |      18 |       15 |           0 |       1 |      83.3% |
| 4 Administration               |       6 |        0 |           0 |       0 |         0% |
| 5 Food Ajo                     |      13 |        3 |           0 |       0 |      23.1% |
| 6 Akawo                        |       7 |        1 |           0 |       0 |      14.3% |
| 7 Bill Payment                 |      11 |        6 |           0 |       2 |      54.5% |
| 8 Progressive KYC              |       8 |        2 |           0 |       1 |        25% |
| 9 Referrals/rewards            |       5 |        1 |           0 |       0 |        20% |
| 10 Notifications               |       8 |        4 |           0 |       0 |        50% |
| 11 Scale/resilience            |      13 |        0 |           0 |       0 |         0% |
| **Total**                      | **122** |   **58** |       **0** |   **4** |  **47.5%** |

## Phase 0 — Foundation

- [x] **COMPLETE** Repository setup
- [x] **COMPLETE** NestJS Fastify bootstrap
- [x] **COMPLETE** Configuration validation
- [x] **COMPLETE** Prisma multi-file setup
- [x] **COMPLETE** PostgreSQL integration
- [x] **COMPLETE** Redis integration
- [x] **COMPLETE** RabbitMQ abstraction
- [x] **COMPLETE** BullMQ foundation
- [x] **COMPLETE** Structured logging
- [x] **COMPLETE** OpenAPI
- [x] **COMPLETE** Docker assets
- [x] **COMPLETE** CI
- [x] **COMPLETE** Health checks
- [x] **COMPLETE** Required documentation foundation

## Phase 1 — Identity and security foundation

- [x] **COMPLETE** Users
- [x] **COMPLETE** Authentication
- [x] **COMPLETE** Sessions and refresh-token reuse handling
- [ ] **NOT STARTED** Device-management API (schema exists)
- [x] **COMPLETE** Roles
- [x] **COMPLETE** Permissions
- [x] **COMPLETE** KYC foundation (schema/provider boundary only)
- [x] **COMPLETE** Audit logging foundation

## Phase 2 — Financial core

- [x] **COMPLETE** Chart-of-accounts schema
- [x] **COMPLETE** Wallet ownership/read API
- [x] **COMPLETE** Double-entry ledger posting/reversal
- [x] **COMPLETE** Idempotency persistence
- [x] **COMPLETE** Available/reserved wallet account semantics used by Bill Payment
- [ ] **NOT STARTED** General payment-provider implementation (schema only)
- [ ] **NOT STARTED** Verified webhook intake framework
- [ ] **NOT STARTED** General reconciliation service
- [ ] **NOT STARTED** Withdrawal workflow
- [ ] **NOT STARTED** General fee application service
- [ ] **NOT STARTED** Settlement processing

## Phase 3 — Traditional Ajo

Acceptance follows [ADR-001](docs/adr/ADR-001-ajo-rotation-and-liquidity.md) and [ADR-002](docs/adr/ADR-002-flexible-ajo-contribution-model.md).

- [x] **COMPLETE** Group lifecycle foundation
- [x] **COMPLETE** Invitations
- [x] **COMPLETE** Memberships
- [x] **COMPLETE** More-than-100 and up-to-1,000 slot capacity
- [x] **COMPLETE** Unique-member versus active-slot separation
- [x] **COMPLETE** Fixed whole-slot contribution mode
- [x] **COMPLETE** Flexible whole-unit contribution mode and liquidity invariant
- [x] **COMPLETE** Multiple slots/positions per member
- [x] **COMPLETE** Contribution calendar stages and business timezone
- [x] **COMPLETE** Payout calendar and processing window
- [x] **COMPLETE** Odd/even deterministic rotation schedule
- [x] **COMPLETE** Serializable group locking
- [x] **COMPLETE** Immutable schedule versions
- [x] **COMPLETE** Two-owner approved/expiring/rejectable audited swaps
- [x] **COMPLETE** Versioned fee definitions and swap fee snapshots
- [ ] **BLOCKED** Multiple payout recipients per period — allocation/default policy unapproved
- [ ] **NOT STARTED** Contribution collection workflow
- [ ] **NOT STARTED** Payout execution/default workflow

## Phase 4 — Administration

- [ ] **NOT STARTED** Super-admin APIs
- [ ] **NOT STARTED** Group-admin APIs beyond lifecycle/swaps
- [ ] **NOT STARTED** General compliance review
- [ ] **NOT STARTED** Transaction monitoring
- [ ] **NOT STARTED** Disputes
- [ ] **NOT STARTED** Reports

## Phase 5 — Food Ajo

- [x] **COMPLETE** Coordinator application and submission
- [ ] **NOT STARTED** Automated KYC/risk/bank checks
- [x] **COMPLETE** Manual compliance review and information request
- [x] **COMPLETE** Tier-3-gated coordinator approval with verification references
- [ ] **NOT STARTED** Coordinator suspension/revocation API
- [ ] **NOT STARTED** Approved-coordinator programme creation
- [ ] **NOT STARTED** Package activation/price locking/capacity service
- [ ] **NOT STARTED** Subscriptions and contributions
- [ ] **NOT STARTED** Vendor approval and tracking
- [ ] **NOT STARTED** Purchase-order, invoice, and receipt workflow
- [ ] **NOT STARTED** Distribution and evidence workflow
- [ ] **NOT STARTED** OTP/QR confirmation service
- [ ] **NOT STARTED** Missing-item/non-delivery disputes

## Phase 6 — Akawo

- [x] **COMPLETE** Canonical Akawo schema for flexible/target/locked goals, maturity, schedules, and withdrawals
- [ ] **NOT STARTED** Flexible savings service
- [ ] **NOT STARTED** Target/goal savings service and progress/statements
- [ ] **NOT STARTED** Locked savings and early-withdrawal rules
- [ ] **NOT STARTED** Auto-save schedules and manual deposits
- [ ] **NOT STARTED** Ledger-backed withdrawal workflow
- [ ] **DEFERRED / POST-MVP** Institutional products, enrolment, yield, settlement, tax, and reconciliation per ADR-003

## Phase 7 — Bill Payment

- [x] **COMPLETE** Provider interface and provider-neutral domain types
- [x] **COMPLETE** Deterministic development mock provider
- [ ] **BLOCKED** Real Monnify adapter — verified official bill API specifications unavailable
- [x] **COMPLETE** Expiring provider catalog persistence
- [x] **COMPLETE** Customer validation with masked/digested reference
- [x] **COMPLETE** Idempotent reservation, provider dispatch, success/failure/uncertain handling
- [ ] **NOT STARTED** Scheduled provider inquiry/reconciliation worker
- [ ] **NOT STARTED** Reversal/refund execution service (models exist)
- [x] **COMPLETE** Immutable receipt snapshot
- [ ] **NOT STARTED** Notification worker/templates for Bill Payment events
- [ ] **BLOCKED** Monnify webhook endpoint — signature/raw-body/event contract unverified

## Phase 8 — Progressive KYC

- [x] **COMPLETE** Tier 1/2/3 data model and action policy
- [x] **COMPLETE** BVN, NIN/vNIN, bank inquiry, face, liveness, and address provider interfaces
- [ ] **NOT STARTED** KYC status and Tier 1 API
- [ ] **NOT STARTED** Bank linking/name inquiry workflow
- [ ] **NOT STARTED** BVN workflow
- [ ] **NOT STARTED** NIN/vNIN workflow
- [ ] **NOT STARTED** Biometric/address workflow and retention jobs
- [ ] **BLOCKED** Real Monnify/Dojah adapters and higher-tier limits — provider/compliance rules unverified

## Phase 9 — Referrals and rewards

- [x] **COMPLETE** Effective-dated campaign/qualification data model and configurable domain rule
- [ ] **NOT STARTED** Settled-event qualification service
- [ ] **NOT STARTED** One-time idempotent reward ledger posting/reversal
- [ ] **NOT STARTED** Device/phone/bank/circular fraud controls
- [ ] **NOT STARTED** Referral notifications

## Phase 10 — Notifications

- [x] **COMPLETE** Template and template-version schema
- [x] **COMPLETE** Channel preferences, timezones, and quiet-hours policy
- [x] **COMPLETE** Delivery attempts, provider references, status, and dedupe schema/policy
- [x] **COMPLETE** Generic email interface and safe console provider
- [ ] **NOT STARTED** Scheduled reminder engine
- [ ] **NOT STARTED** BullMQ delivery retries/dead-letter operations
- [ ] **NOT STARTED** Full product event template catalog and delivery services
- [ ] **NOT STARTED** Brevo adapter evaluation/approval (currently under consideration)

## Phase 11 — Scale and resilience

- [ ] **NOT STARTED** Load tests
- [ ] **NOT STARTED** Query optimization
- [ ] **NOT STARTED** Index review
- [ ] **NOT STARTED** PgBouncer
- [ ] **NOT STARTED** Horizontal scaling
- [ ] **NOT STARTED** Worker separation deployment
- [ ] **NOT STARTED** Outbox relay scaling
- [ ] **NOT STARTED** Backups
- [ ] **NOT STARTED** Point-in-time recovery
- [ ] **NOT STARTED** Disaster recovery
- [ ] **NOT STARTED** Penetration testing
- [ ] **NOT STARTED** Reconciliation testing
- [ ] **NOT STARTED** Production readiness review
