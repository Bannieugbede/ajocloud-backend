# Database

PostgreSQL is authoritative. Prisma 7 loads `prisma/schema.prisma` and all fragments under `prisma/models`. UUID primary keys, timestamptz audit fields, targeted status/ownership indexes, provider-event uniqueness, and internal/idempotency reference uniqueness support correctness and operational queries. Ajo members, units/slots, and payout positions are separate records and counts. Schedule and fee versions preserve the terms used by historical financial records.

Money uses `BigInt` minor units plus ISO currency. NGN 10,000.00 is stored as `1000000`. Decimal is reserved for physical food quantities. Referential deletes are restrictive for financial/business history; identity-owned session/profile data may cascade.

Serializable transactions are required for refresh rotation/reuse handling, slot allocation, group locking/schedule creation/versioned swaps, Bill Payment reserve/settlement/release/reversal, ledger posting/reversal, and competing idempotency claims. Migrations are generated and reviewed, deployed separately, and never run during API startup.

All timestamps are UTC. Ajo groups retain an IANA business timezone and explicit contribution/payout stage timestamps. Provider metadata is minimized and redacted; raw identity and biometric payloads have no general-purpose storage column.

Account verification challenges store a channel, masked destination, HMAC digest, expiry, cooldown,
attempt count, and terminal timestamps. Versioned user consent rows are unique per user/type/version.
Migration `20260716180000_account_verification` adds both structures and their lifecycle indexes.
