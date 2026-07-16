# Current status

- Last updated: 2026-07-16
- Current phase: Phase 1 identity/security and Phase 2 financial-core hardening

## Complete

Foundation bootstrap/infrastructure/docs; full initial schema; environment guard; auth/session rotation; live permissions; users/profile; wallet ownership reads; Ajo create/join/lock/schedule; ledger balance/reversal foundation; audit/idempotency models/services; Docker/CI; unit/E2E foundations.

## In progress

No roadmap item is intentionally marked in progress at this handoff.

## Blocked

Real payment/KYC adapters and Ajo default/swap/penalty/payout rules require product, compliance, and provider decisions. Docker is not installed in the current workstation, so local service-container and migration-deploy execution could not be exercised here.

## Next recommended tasks

1. Add PostgreSQL integration tests for auth rotation, group locking concurrency, idempotency, ledger posting/reversal, and transaction rollback.
2. Implement durable outbox relay plus RabbitMQ inbox consumer topology.
3. Approve Ajo default/swap rules, then implement swap approval service.
4. Implement verified payment-webhook intake before any real money simulation.

## Unresolved decisions and risks

See ADR-001 and open questions. Primary risks are absent provider verification, incomplete financial integration/concurrency coverage, no rate-limit Redis storage, no device/MFA APIs, and schemas without services for later domains.

## Verification and migrations

Final `bun run check` passed: formatting, lint, strict typecheck, Prisma validation/generation, 12 unit tests, and build. The Fastify E2E suite passed 1 test; the integration command passed with no tests present. Unit coverage is 10.14% statements overall (domain rules are substantially higher), so service-level coverage is a known gap. The initial SQL migration exists but migration status/apply could not connect because Docker/PostgreSQL is unavailable locally.

`bun audit --production` reported two moderate transitive advisories (`ajv` `$data` ReDoS and a Prisma-development Hono static-path issue), with no high or critical finding. The affected `$data`/static-serving features are not used; upgrades remain tracked.
