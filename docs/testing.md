# Testing

Unit tests cover environment validation, rotation boundaries/exact reconciliation, and ledger balance invariants. E2E tests use Fastify injection. Integration tests must use real PostgreSQL/Redis/RabbitMQ through CI services or Testcontainers; never SQLite for transaction behaviour.

Phase 1/2 additions require registration/login/rotation/revocation, duplicate keys/events, rollback, concurrent posting, permission and cross-group denial, sensitive serialization, and webhook replay tests. Run `bun run check`, then integration and e2e suites before merge.
