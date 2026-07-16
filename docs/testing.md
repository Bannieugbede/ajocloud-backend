# Testing

Unit tests cover environment validation, rotation boundaries/exact reconciliation, and ledger balance invariants. E2E tests use Fastify injection. Integration tests must use real PostgreSQL/Redis/RabbitMQ through CI services or Testcontainers; never SQLite for transaction behaviour.

Phase 1/2 additions require registration/login/rotation/revocation, duplicate keys/events, rollback, concurrent posting, permission and cross-group denial, sensitive serialization, and webhook replay tests. Run `bun run check`, then integration and e2e suites before merge.

The product-scope integration suite uses PostgreSQL check constraints and serializable ledger commands. Set `RUN_DATABASE_INTEGRATION=true` with a migrated disposable PostgreSQL database for local execution; GitHub CI runs it automatically. Provider mock tests never represent real provider success, and real adapter contract/webhook tests remain blocked until verified specifications exist.
