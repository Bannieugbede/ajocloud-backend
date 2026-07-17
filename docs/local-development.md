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
