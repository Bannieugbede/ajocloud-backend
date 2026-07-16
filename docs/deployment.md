# Deployment

Build the multi-stage Docker image and inject validated secrets at runtime. The image runs as the unprivileged `node` user. Place it behind TLS termination and a trusted proxy; configure exact CORS origins and infrastructure-level compression.

Deploy reviewed migrations as a separate release step before compatible code. Never seed or run development migrations during startup. Use readiness for traffic admission, stop accepting traffic on shutdown, drain workers, then close messaging/cache/database connections. Production requires encrypted backups, PITR, restore drills, PgBouncer review, metrics/traces, alerting, and rollback plans.
