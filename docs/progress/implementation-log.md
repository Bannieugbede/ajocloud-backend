# Implementation log

## 2026-07-16 — Production foundation

- Work: Replaced the Nest starter with a Fastify modular monolith; implemented configuration, logging, health, auth/session rotation, permissions, users, Ajo workflow, wallets, ledger, audit, idempotency, Redis/RabbitMQ/BullMQ foundations, worker/scheduler, Docker, CI, seeds, and docs.
- Files/modules: `src`, `prisma`, `.github`, container/environment configuration, and all required documentation.
- Migration: generated initial PostgreSQL migration; not applied locally because Docker is unavailable.
- Tests: environment, Ajo odd/even/multiple-slot/capacity/duration/exact-pool rules, ledger balance rejection, and Fastify health endpoint.
- Decisions: integer minor units; equal whole slots; one recipient per cycle; no platform float; immutable locked schedule; live database-backed sessions/permissions.
- Security: Argon2id, hashed rotating refresh tokens with reuse revocation, strict DTOs/CORS/headers/rate limits, scoped authorization, secret/audit redaction, non-root image.
- Remaining: provider adapters/webhooks, integration/concurrency tests, outbox relay/consumers, swap/penalty/contribution/payout services, later product modules, and production readiness work.
- Quality: format, lint, strict typecheck, Prisma validate/generate, build, 12 unit tests, and 1 Fastify E2E test passed. Integration command found no tests. Coverage was 10.14% statements overall. Migration status failed only because local PostgreSQL was unavailable. Audit found two moderate transitive advisories and no high/critical findings.
