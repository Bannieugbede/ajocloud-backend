# Ajo Cloud roadmap

Status labels: **COMPLETE**, **IN PROGRESS**, **BLOCKED**, **NOT STARTED**, **DEFERRED / POST-MVP**. Schema or interface work alone is not a completed product workflow. Every complete item has implementation, tests, authorization/security treatment, and documentation. Blockers and evidence live in [current status](docs/progress/current-status.md).

| Phase                          |   Total | Complete | In progress | Blocked | Completion |
| ------------------------------ | ------: | -------: | ----------: | ------: | ---------: |
| 0 Foundation                   |      14 |       14 |           0 |       0 |       100% |
| 1 Identity/security foundation |       8 |        8 |           0 |       0 |       100% |
| 2 Financial core               |      11 |        7 |           0 |       0 |      63.6% |
| 3 Traditional Ajo              |      18 |       17 |           0 |       1 |      94.4% |
| 4 Administration               |       6 |        1 |           0 |       0 |      16.7% |
| 5 Food Ajo                     |      13 |        8 |           2 |       0 |      61.5% |
| 6 Akawo                        |       8 |        4 |           1 |       0 |        50% |
| 7 Bill Payment                 |      11 |        6 |           0 |       2 |      54.5% |
| 8 Progressive KYC              |       8 |        2 |           0 |       1 |        25% |
| 9 Referrals/rewards            |       5 |        1 |           0 |       0 |        20% |
| 10 Notifications               |       8 |        5 |           1 |       0 |      62.5% |
| 11 Scale/resilience            |      13 |        0 |           0 |       0 |         0% |
| **Total**                      | **123** |   **69** |       **2** |   **3** |    **56%** |

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
- [x] **COMPLETE** Password authentication, email account verification, and consent recording
- [x] **COMPLETE** Sessions and refresh-token reuse handling
- [x] **COMPLETE** Device-management API — every installation registers at sign-in with an optional
      Expo push token; list and deregister are owner-scoped, and the token is never returned.
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
  - Extended with owner-scoped derived wallet summary and activity APIs for the mobile wallet phase.
- [ ] **NOT STARTED** General payment-provider implementation (schema only)
- [x] **COMPLETE** Verified webhook intake framework — events are recorded before processing, and a
      successful transaction now posts to the ledger (ADR-010). Money can enter the platform.
- [ ] **NOT STARTED** General reconciliation service
- [ ] **NOT STARTED** Withdrawal workflow
- [x] **COMPLETE** General fee application service — cost-plus tiered pricing (ADR-009) resolved
      from versioned definitions, applied to deposits and netted from the credit.
- [ ] **NOT STARTED** Settlement processing

## Phase 3 — Traditional Ajo

Acceptance follows [ADR-001](docs/adr/ADR-001-ajo-rotation-and-liquidity.md) and [ADR-002](docs/adr/ADR-002-flexible-ajo-contribution-model.md).

- [x] **COMPLETE** Group lifecycle foundation
- [x] **COMPLETE** Invitations — `POST/GET/DELETE /ajo-groups/:groupId/invitations` issue, list and
      revoke shareable links; `GET /invitations/:code` describes the group to an unauthenticated
      recipient, and `GET /ajo-groups/invitations/:code/group` resolves the code for a signed-in
      one. The code is stored only as a peppered HMAC and returned once. The schema existed but
      nothing issued a link, so a group could only be joined by someone who already held a code.
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
- [x] **COMPLETE** Two-owner approved/expiring/rejectable audited swaps — including
      `GET /ajo-groups/:groupId/swaps`, which reports `awaitingMyDecision` per request. Approve and
      reject existed but nothing listed a pending swap, so one could only be acted on by a caller
      who already knew its id.
- [x] **COMPLETE** Versioned fee definitions and swap fee snapshots
- [ ] **BLOCKED** Multiple payout recipients per period — allocation/default policy unapproved
- [x] **COMPLETE** Contribution collection workflow — `POST /ajo-groups/:groupId/contributions/:scheduleId/pay`
      debits the member's wallet and credits a per-group pool account in one serializable
      transaction. The balance is re-read inside it and an overdraft refused, because a negative
      member balance is a platform float by another name (ADR-001). Part payment is supported;
      the schedule reaches PAID only when the amounts agree.
- [x] **COMPLETE** Payout execution — `POST /ajo-groups/:groupId/payouts/:payoutScheduleId/execute`
      pays a cycle's pool to the slot whose turn it is, and refuses unless every contribution in
      that cycle is settled, holding the schedule instead. Two guards: the schedule check is the
      business rule, the pool-balance check is the invariant (ADR-011). Default handling beyond
      HELD — penalties, removing a defaulter — still needs its own ADR.

## Phase 4 — Administration

- [ ] **NOT STARTED** Super-admin APIs
- [ ] **NOT STARTED** Group-admin APIs beyond lifecycle/swaps
- [x] **COMPLETE** General compliance review — KYC decision workflow. `GET /admin/kyc-profiles`
      (queue) and `/:id` (evidence), plus `POST /:id/{approve,reject,request-information,escalate}`,
      all behind `kyc.review`. Each decision is one serializable transaction that moves the profile,
      closes the open `ComplianceReview`, and writes an audit entry plus an outbox event. Approval
      refuses a tier the profile's passed checks do not evidence, and a settled profile cannot be
      silently re-decided. 18 tests.
- [ ] **NOT STARTED** Transaction monitoring
- [ ] **NOT STARTED** Disputes
- [ ] **NOT STARTED** Reports

## Phase 5 — Food Ajo

- [x] **COMPLETE** Coordinator application and submission
- [ ] **NOT STARTED** Automated KYC/risk/bank checks
- [x] **COMPLETE** Manual compliance review and information request
- [x] **COMPLETE** Tier-3-gated coordinator approval with verification references
- [ ] **NOT STARTED** Coordinator suspension/revocation API
- [x] **COMPLETE** Approved-coordinator programme creation and authenticated programme reads
- [x] **COMPLETE** Package activation/price locking/capacity service — opening a programme stamps
      `priceLockedAt` on every package, and a locked package is refused for edit, so the price a
      member enrolled against cannot be changed underneath them.
- [ ] **IN PROGRESS** Subscriptions and contributions — enrolment, withdrawal, and portion-based
      capacity are implemented. Contributions are not collected: the `FOOD_SUBSCRIPTION` payment
      target exists but no route settles one, so a programme's expected amount is what members owe
      rather than what has been received.
- [ ] **IN PROGRESS** Vendor approval and tracking — coordinators can propose and list vendors, and
      orders are refused for an unverified one. The approval route itself is admin work and is not
      built.
- [x] **COMPLETE** Purchase-order, invoice, and receipt workflow — orders are sized from enrolled
      portions rather than capacity, totalled server-side through integer arithmetic, restricted to
      verified vendors, and cannot be marked fulfilled until a receipt is recorded by storage key
      and content hash.
- [x] **COMPLETE** Distribution and evidence workflow — items are built server-side from live
      subscriptions, and neither the distribution nor the programme can be completed while a member
      is still owed food.
- [x] **COMPLETE** OTP/QR confirmation service — one-time 30-minute collection codes issued to the
      member (never the coordinator), stored only as a digest and burnt on use.
- [ ] **NOT STARTED** Missing-item/non-delivery disputes

## Phase 6 — Akawo

- [x] **COMPLETE** Canonical Akawo schema for flexible/target/locked goals, maturity, schedules, and withdrawals
- [x] **COMPLETE** Flexible savings goal creation and owner-scoped reads
- [x] **COMPLETE** Target/goal creation, progress, and paginated statements
- [ ] **NOT STARTED** Locked savings and early-withdrawal rules
- [ ] **IN PROGRESS** Auto-save schedules and manual deposits — schedule creation implemented;
      execution and ledger-backed manual deposits require Akawo financial-account ownership support
- [ ] **NOT STARTED** Ledger-backed withdrawal workflow
- [x] **COMPLETE** Akawo group pools — organiser-created collection pools with digest-stored join
      codes, member self-identification, per-member dues, lifecycle, waivers, and an organiser
      record view. Collection is blocked on the payment workflow: `PAID` is reachable only by a
      settled ledger posting, and no route writes it. ADR-007. 23 tests.
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
- [x] **IN REVIEW (2026-08-19)** Transaction PIN. `TransactionPin` model plus
      `GET/POST /auth/transaction-pin` and `POST /auth/transaction-pin/verify`. The PIN is hashed
      with Argon2id exactly as passwords are and is never returned or logged; five consecutive
      failures lock it for 15 minutes, and replacing a PIN requires proving the current one.
      Predictable PINs (repeated digits, straight runs) are refused. 27 tests.
- [ ] **BLOCKED (2026-08-19)** BVN/NIN verification, Nigerian bank list, and account-name inquiry,
      needed by the mobile sign-up step form. Requires an ADR settling provider choice, required
      Tier 2 fields, and retry/failure limits. Agreed constraint: the raw identifier is never
      persisted — only the masked value, result, and provider reference, per docs/kyc.md.
- [ ] **NOT STARTED** Bank linking/name inquiry workflow
- [ ] **NOT STARTED** BVN workflow
- [ ] **NOT STARTED** NIN/vNIN workflow
- [ ] **NOT STARTED** Biometric/address workflow and retention jobs
- [ ] **RELEASE BLOCKER** Re-verify or demote every KYC check flagged `SANDBOX_FALLBACK` before the first production release; those identities passed against the mock provider, not Monnify (ADR-006).
- [x] **COMPLETE (settlement)** Ledger posting for successful transactions — ADR-010 sets the
      account mapping and nets the fee from the credit. Refund and disbursement posting stay open:
      reversal handling waits on fee refundability, and payouts are a separate workflow.
- [ ] **BLOCKED** Real Monnify payment/bill-payment/payout adapters and higher-tier limits — provider/compliance rules unverified. Monnify identity verification is implemented (ADR-005) but its endpoint paths are unconfirmed.

## Phase 9 — Referrals and rewards

- [x] **COMPLETE** Effective-dated campaign/qualification data model and configurable domain rule
- [ ] **NOT STARTED** Settled-event qualification service
- [ ] **NOT STARTED** One-time idempotent reward ledger posting/reversal
- [ ] **NOT STARTED** Device/phone/bank/circular fraud controls
- [ ] **NOT STARTED** Referral notifications

## Phase 10 — Notifications

- [x] **COMPLETE** Template and template-version schema
- [x] **COMPLETE** Channel preferences, timezones, and quiet-hours policy — schema, policy, and now
      the `GET`/`PUT /users/me/notification-preferences` API, applied on every send. Security and
      account-recovery templates carry no topic and are never suppressed or delayed.
- [x] **COMPLETE** Delivery attempts, provider references, status, and dedupe schema/policy
- [x] **COMPLETE** Generic email interface and safe console provider
- [ ] **NOT STARTED** Scheduled reminder engine
- [ ] **NOT STARTED** BullMQ delivery retries/dead-letter operations
- [ ] **IN PROGRESS** Full product event template catalog and delivery services — email, push, and
      in-app delivery all work and are preference-gated, with short-form push copy for every product
      template. Three product events now emit: an Ajo payout sent, a wallet funded by a settled
      deposit, and a KYC decision. Each is sent after its transaction commits and never awaited, so
      a notification provider being down cannot undo or appear to fail the money movement. Still
      outstanding: contribution reminders and Akawo progress need a scheduler rather than a request,
      and Food distribution and Bill Payment have no emitter yet.
- [x] **COMPLETE** Brevo transactional email/SMS adapters through the official SDK with generic
      provider boundaries, validated configuration, deterministic dedupe, persisted message IDs,
      redacted failures, and safe console/mock alternatives

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
