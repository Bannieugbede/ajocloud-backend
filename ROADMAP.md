# Ajo Cloud roadmap

Status labels: **COMPLETE**, **IN PROGRESS**, **BLOCKED**, **NOT STARTED**, **DEFERRED**. Every item uses the acceptance criteria in the linked phase documentation: implementation, tests, security review, and docs must exist before completion. Dependencies are earlier phases unless noted; blockers and notes live in [current status](docs/progress/current-status.md).

| Phase                 |  Total | Complete | In progress | Blocked | Completion |
| --------------------- | -----: | -------: | ----------: | ------: | ---------: |
| 0 Foundation          |     14 |       14 |           0 |       0 |       100% |
| 1 Identity/security   |      8 |        7 |           0 |       0 |      87.5% |
| 2 Financial core      |     10 |        4 |           0 |       0 |        40% |
| 3 Traditional Ajo MVP |     11 |        7 |           0 |       0 |      63.6% |
| 4 Administration      |      6 |        0 |           0 |       0 |         0% |
| 5 Food Ajo            |      8 |        0 |           0 |       0 |         0% |
| 6 Akawa               |      4 |        0 |           0 |       0 |         0% |
| 7 Scale/resilience    |     13 |        0 |           0 |       0 |         0% |
| **Total**             | **74** |   **32** |       **0** |   **0** |  **43.2%** |

## Phase 0 — Foundation

Acceptance: starts with validated config, infrastructure health is observable, CI and local commands are reproducible, and [architecture](docs/architecture.md) is current.

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
- [x] **COMPLETE** Docker
- [x] **COMPLETE** CI
- [x] **COMPLETE** Health checks
- [x] **COMPLETE** Required documentation

## Phase 1 — Identity and security

Acceptance: see [authentication](docs/authentication.md), [authorization](docs/authorization.md), and [testing](docs/testing.md).

- [x] **COMPLETE** Users
- [x] **COMPLETE** Authentication
- [x] **COMPLETE** Sessions
- [ ] **NOT STARTED** Device-management API (schema exists)
- [x] **COMPLETE** Roles
- [x] **COMPLETE** Permissions
- [x] **COMPLETE** KYC foundation (schema/provider boundary only)
- [x] **COMPLETE** Audit logging foundation

## Phase 2 — Financial core

Acceptance: posted movements balance, retry safely, reverse immutably, and pass PostgreSQL concurrency tests per [ledger documentation](docs/financial-ledger.md).

- [x] **COMPLETE** Chart of accounts schema
- [x] **COMPLETE** Wallet ownership/read API
- [x] **COMPLETE** Double-entry ledger posting/reversal
- [x] **COMPLETE** Idempotency persistence
- [ ] **NOT STARTED** Payment provider implementation (schema only)
- [ ] **NOT STARTED** Webhook intake endpoint (schema only)
- [ ] **NOT STARTED** Reconciliation service (schema only)
- [ ] **NOT STARTED** Withdrawal workflow (schema only)
- [ ] **NOT STARTED** Fee application service (schema only)
- [ ] **NOT STARTED** Settlement processing (schema only)

## Phase 3 — Traditional Ajo MVP

Acceptance: follow [ADR-001](docs/adr/ADR-001-ajo-rotation-and-liquidity.md); exact pool reconciliation and scope checks are mandatory.

- [x] **COMPLETE** Group lifecycle foundation
- [x] **COMPLETE** Invitations
- [x] **COMPLETE** Memberships
- [x] **COMPLETE** Multiple whole slots
- [x] **COMPLETE** Contribution schedules
- [x] **COMPLETE** Rotation schedule
- [x] **COMPLETE** Group locking
- [ ] **NOT STARTED** Swap workflow service (schema only)
- [ ] **NOT STARTED** Penalty workflow service (schema only)
- [ ] **NOT STARTED** Contribution collection (schema only)
- [ ] **NOT STARTED** Payout execution (schema only)

## Phase 4 — Administration

Acceptance: fine-grained, audited, scoped administrative commands with authorization tests.

- [ ] **NOT STARTED** Super-admin APIs
- [ ] **NOT STARTED** Group-admin APIs beyond locking
- [ ] **NOT STARTED** Compliance review
- [ ] **NOT STARTED** Transaction monitoring
- [ ] **NOT STARTED** Disputes
- [ ] **NOT STARTED** Reports

## Phase 5 — Food Ajo

Acceptance: verified coordinators and traceable procurement/distribution; models exist, services do not.

- [ ] **NOT STARTED** Coordinator verification
- [ ] **NOT STARTED** Packages
- [ ] **NOT STARTED** Subscriptions
- [ ] **NOT STARTED** Vendor management
- [ ] **NOT STARTED** Purchase orders
- [ ] **NOT STARTED** Receipt uploads
- [ ] **NOT STARTED** Distributions
- [ ] **NOT STARTED** OTP/QR confirmation

## Phase 6 — Akawa

Acceptance: approved withdrawal rules and ledger-backed movements; models exist, services do not.

- [ ] **NOT STARTED** Savings goals
- [ ] **NOT STARTED** Schedules
- [ ] **NOT STARTED** Locked/flexible rules
- [ ] **NOT STARTED** Contributions and withdrawals

## Phase 7 — Scale and resilience

Acceptance: measured SLOs, recovery evidence, and production security review.

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
