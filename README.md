# Ajo Cloud Backend

Ajo Cloud is a modular-monolith backend for Traditional Ajo, Akawo savings, Food Ajo, wallets, payments and disbursements, Bill Payment, KYC, referrals, notifications, administration, fees, disputes, and auditable financial operations. Financial correctness, traceability, authorization boundaries, and idempotency take priority over convenience.

## Stack

- Node.js 24 LTS; Bun 1.3.11 package/runtime tooling
- NestJS 11.1.28 on Fastify (no Express)
- TypeScript 5.9 in strict mode
- Prisma ORM 7.8 with PostgreSQL adapter; PostgreSQL 18 locally
- Redis 8, BullMQ 5, RabbitMQ 4
- Brevo Node SDK 6 for transactional email and SMS
- Pino JSON logging, Zod environment validation, Swagger/OpenAPI

## Prerequisites

Install Node.js 24+, Bun 1.3.11+, and Docker with Compose. The code can build and run unit tests without Docker; API readiness and integration work require PostgreSQL, Redis, and RabbitMQ.

## Setup

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run docker:up
bun run prisma:generate
bun run prisma:migrate:deploy
ALLOW_SEED=true bun run prisma:seed
```

Replace all local placeholder secrets before starting the API. Never use example values in a shared or production environment.

To use Brevo, set `EMAIL_PROVIDER=brevo`, `SMS_PROVIDER=brevo`, `BREVO_API_KEY`, a verified
`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and an approved `BREVO_SMS_SENDER`. SMTP relay
credentials may be kept in `SMTP_URL`, but the application adapters use Brevo's authenticated API.

## Running processes

```bash
bun run dev
bun run start:worker
bun run start:scheduler
```

The API defaults to `http://localhost:3000/api/v1`. Interactive Swagger API documentation is at
`http://localhost:3000/docs`; liveness and readiness are `/api/v1/health/live` and
`/api/v1/health/ready`. Registration uses email verification before issuing a session.
RabbitMQ's local-only management UI is at `http://localhost:15672`.

## Database and Prisma

The generator/datasource live in `prisma/schema.prisma`; supported multi-file fragments live in `prisma/models`. Migrations are under `prisma/migrations`, and environment-guarded seed code is under `prisma/seed`.

```bash
bun run prisma:validate
bun run prisma:migrate:dev -- --name descriptive_name
bun run prisma:migrate:status
bun run prisma:studio
```

Money is stored as `BigInt` integer minor units: NGN 10,000.00 is `1000000`. API serialization returns these values as decimal strings. Wallet balances are derived from immutable, balanced ledger entries—not directly updated balance columns.

## Quality commands

```bash
bun run format
bun run format:check
bun run lint
bun run typecheck
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:cov
bun run build
bun run check
```

## Deployment

`Dockerfile` is a multi-stage non-root production image. Deploy migrations separately with `bun run prisma:migrate:deploy`; application startup never runs migrations or seeds. Terminate traffic before stopping workers and infrastructure connections. See [deployment](docs/deployment.md).

## Troubleshooting

- Configuration failure: compare `.env` with `.env.example`; secrets require at least 32 characters.
- Readiness is 503: inspect PostgreSQL, Redis, and RabbitMQ health with `bun run docker:logs`.
- Prisma cannot locate models: `prisma.config.ts` must point at the `prisma` directory, not a glob.
- Seed refuses to run: set `ALLOW_SEED=true`; production seeding is deliberately prohibited.

## Documentation

- [Architecture](docs/architecture.md), [database](docs/database.md), [ledger](docs/financial-ledger.md)
- [Bill Payment](docs/bill-payments.md), [progressive KYC](docs/kyc.md), [Food Ajo](docs/food-ajo.md), [Akawo](docs/akawo.md), [referrals](docs/referrals.md)
- [Authentication](docs/authentication.md), [authorization](docs/authorization.md), [API conventions](docs/api-conventions.md)
- [Messaging](docs/messaging.md), [observability](docs/observability.md), [testing](docs/testing.md)
- [Notifications](docs/notifications.md) and [Brevo provider selection](docs/open-questions/email-provider-selection.md)
- [Local development](docs/local-development.md), [deployment](docs/deployment.md), [security policy](SECURITY.md)
- [Roadmap](ROADMAP.md), [current status](docs/progress/current-status.md), [implementation log](docs/progress/implementation-log.md)
- [ADRs](docs/adr/README.md), [open financial questions](docs/open-questions/ajo-financial-rules.md)
- [Brand](docs/brand.md), [flexible Ajo questions](docs/open-questions/flexible-ajo-contribution-rules.md), and [provider/product references](docs/product-reference)
