# Local development

Copy `.env.example`, replace placeholder secrets, run `bun run docker:up`, deploy migrations, and explicitly seed with `ALLOW_SEED=true`. Start API, worker, and scheduler in separate terminals. RabbitMQ management is local-only.

Use `bun run docker:logs` for infrastructure diagnosis and `/api/v1/health/ready` for dependency status. Stop with `bun run docker:down`; volumes are retained.
