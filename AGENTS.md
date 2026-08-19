# Codex working agreement

## Before work

Before every substantial task, read this file, [README.md](README.md), [ROADMAP.md](ROADMAP.md), [current status](docs/progress/current-status.md), relevant [ADRs](docs/adr/README.md), open questions, and the relevant module documentation.

Before changing Ajo calculations, fees, bill payments, KYC, referrals, Food Ajo coordinator verification, or future Akawo products, read the topic's ADR, open-question document, and product-reference notes. Unresolved questions are not authorization to invent a rule.

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
- Product references such as CircleFunds, PiggyVest, Monnify, Moniepoint, Dojah, and Brevo are research and integration references. They must not be treated as approved business rules, permanent pricing sources, regulatory authority, or permission to copy proprietary behaviour.
- Any external-provider pricing, fee, limit, endpoint, webhook structure, or availability must be verified against current official provider documentation and the organisation's commercial agreement before production implementation.
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
- [Bill Payment](docs/bill-payments.md), [progressive KYC](docs/kyc.md), [Food Ajo](docs/food-ajo.md), [Akawo](docs/akawo.md), and [referrals](docs/referrals.md)
- [Flexible Ajo questions](docs/open-questions/flexible-ajo-contribution-rules.md), [referral qualification](docs/open-questions/referral-qualification-rule.md), and [email provider selection](docs/open-questions/email-provider-selection.md)

## Version control

Commit every code change. Do not leave completed work uncommitted in the working
tree: an uncommitted change is invisible to everyone else and is lost with the
checkout.

- Commit when a unit of work is complete and verification passes, not at the end
  of a long session. Several focused commits beat one sprawling one.
- Run the project's verification before committing. Do not commit a red tree; if
  something is genuinely broken and must be recorded, say so in the message.
- Write messages that state what changed and why. The diff already shows the
  what, so the why is the part worth writing down.
- Never commit secrets, credentials, `.env` files, tokens, or real identity or
  financial data. Check the staged diff before committing.
- Branch before committing when on the default branch, and push or open a pull
  request only when the user asks.
