# Codex working agreement

## Before work

Before every substantial task, read this file, [README.md](README.md), [ROADMAP.md](ROADMAP.md), [current status](docs/progress/current-status.md), relevant [ADRs](docs/adr/README.md), and the relevant module documentation.

## Purpose and architecture

Ajo Cloud is a financial modular monolith with separate API, worker, and scheduler entry points. Keep controllers, application orchestration, domain rules, persistence, and external adapters separate. Modules live in `src/modules`; shared HTTP primitives in `src/common`; adapters in `src/infrastructure`; bootstrap code in `src/bootstrap`.

Prisma uses `prisma/schema.prisma` plus fragments in `prisma/models`. Migrations and seeds live in their named directories. Repositories/services own persistence; controllers never call Prisma.

## Non-negotiable rules

- Represent money as integer minor-unit `bigint`, always with currency. Serialize bigint as strings.
- The append-only, double-entry ledger is the balance source of truth. Posted entries are never edited; corrections reverse and replace.
- Use serializable transactions or explicit locking for balance-affecting operations, slot allocation, group locking, and unique command processing. Never hold a transaction across network I/O.
- Money-moving and provider commands require idempotency. Webhooks are persisted before processing; inbox/outbox events are durable and deduplicated.
- Never silently change financial rules. Any change to ledger behaviour, fees, payout scheduling, contribution allocation, withdrawal processing, reconciliation, or idempotency requires an ADR or an update to an existing ADR.
- Validate all input, return explicit DTO shapes, enforce tenant/group ownership server-side, and combine fine-grained permissions with resource scope.
- Hash passwords with Argon2id. Store only refresh-token digests, rotate on use, and revoke the session family on reuse.
- Never log secrets, credentials, tokens, OTPs, raw identity numbers, card data, or unredacted provider payloads. Do not use unsafe raw SQL.
- No implicit `any`, floating promises, catch-and-ignore, controller persistence, God services, circular modules, direct wallet balance mutation, fake money/provider success, or production auto-migration/seed.

## Testing and definition of done

Add unit tests for domain rules and PostgreSQL integration tests for transaction behaviour. Do not substitute SQLite. Test cross-scope authorization, idempotency, replay, and financial invariants. A task is complete only when implementation exists, format/lint/typecheck/tests/build pass, docs and tracking files are updated, and no known critical security issue remains.

After each completed task update [ROADMAP.md](ROADMAP.md), [current status](docs/progress/current-status.md), [implementation log](docs/progress/implementation-log.md), affected documentation/tests, and [CHANGELOG.md](CHANGELOG.md) for user-visible or architectural changes.

## Commands

Use `bun run check` for non-destructive verification. Other verified commands are documented in [README.md](README.md).

## Required references

- [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md)
- [architecture](docs/architecture.md), [database](docs/database.md), [financial ledger](docs/financial-ledger.md)
- [current status](docs/progress/current-status.md), [implementation log](docs/progress/implementation-log.md)
- [ADR index](docs/adr/README.md), [open Ajo financial rules](docs/open-questions/ajo-financial-rules.md)
