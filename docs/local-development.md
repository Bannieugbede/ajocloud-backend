# Local development

Copy `.env.example`, replace placeholder secrets, run `bun run docker:up`, deploy migrations, and explicitly seed with `ALLOW_SEED=true`. Start API, worker, and scheduler in separate terminals. RabbitMQ management is local-only.

For physical-device testing, keep `HOST=0.0.0.0`, use the computer's LAN address in the mobile
app's `.env.local`, and allow the corresponding Expo web origin in `CORS_ORIGINS`. The API remains
under `/api/v1`; interactive API documentation is available at `/docs` when
`SWAGGER_ENABLED=true`.

Use `bun run docker:logs` for infrastructure diagnosis and `/api/v1/health/ready` for dependency
status. `NODE_ENV=development` formats Pino output for the terminal while retaining request IDs and
redaction; production and test environments keep structured JSON. Stop with `bun run docker:down`;
volumes are retained.

## Seed data

`bun run prisma:seed` requires `ALLOW_SEED=true` and refuses to run when
`NODE_ENV=production`. `TOKEN_PEPPER` must be set: it hashes the seeded
verification code, the transaction PIN, and the linked bank account digest.

The seed is split by feature under `prisma/seed/seeders/`; see that directory's
README for what each covers and the rules for adding one. Every write is an
upsert or a guarded create, so the seed is safe to re-run.

Fixtures standing in for a secret are computed with the same helper the
application uses, so they genuinely work rather than only looking right:

| Fixture             | Value                                     |
| ------------------- | ----------------------------------------- |
| Password (all)      | `Development-Only-Password-123!`          |
| Email verification  | `222222` for `email.pending@example.test` |
| Transaction PIN     | `1357` for `ada.admin@example.test`       |
| Ajo invitation code | `AJOTEST-INVITE-2026`                     |
| Ajo referral code   | `AJOTEST-REFERRAL-2026`                   |

Mock identity checks stay strict: test identifiers must end in `0001` to pass,
e.g. BVN `22345670001`, account number `0123450001`.

Three areas are deliberately unseeded. `NotificationTemplate` would be a second
source of truth, since templates live in `src/modules/notifications/templates`
and nothing reads that table. `AdminNotification` is derived by the console's
sync endpoint, which dedupes by subject. Payout, withdrawal, contribution and
dispute rows would represent states no code can produce or transition out of,
because those workflows are not built yet.
