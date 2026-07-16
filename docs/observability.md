# Health and observability

Pino emits structured JSON with request IDs and redaction for authorization, cookies, passwords, tokens, OTPs, and credential hashes. Add only safe user/organisation/group correlation fields. Provider payloads and identity numbers are prohibited.

Liveness reports process/build metadata. Readiness probes PostgreSQL, Redis, and RabbitMQ with timeouts and returns only dependency names/status. OpenTelemetry environment hooks are reserved; HTTP, Prisma, Redis, RabbitMQ, BullMQ, and provider spans should share correlation IDs when instrumentation is enabled.
