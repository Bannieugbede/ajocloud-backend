# Database

PostgreSQL is authoritative. Prisma 7 loads `prisma/schema.prisma` and all fragments under `prisma/models`. UUID primary keys, timestamptz audit fields, targeted status/ownership indexes, provider-event uniqueness, and internal/idempotency reference uniqueness support correctness and operational queries.

Money uses `BigInt` minor units plus ISO currency. NGN 10,000.00 is stored as `1000000`. Decimal is reserved for physical food quantities. Referential deletes are restrictive for financial/business history; identity-owned session/profile data may cascade.

Serializable transactions are required for refresh rotation/reuse handling, slot allocation, group locking/schedule creation, ledger posting/reversal, and competing idempotency claims. Migrations are generated and reviewed, deployed separately, and never run during API startup.
