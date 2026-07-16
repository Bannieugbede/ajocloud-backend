# API conventions

REST endpoints use `/api/v1`, camelCase JSON, ISO-8601 UTC timestamps, explicit request DTOs, whitelist validation, and rejection of unknown properties. Authentication uses bearer access tokens. BigInt minor units serialize as decimal strings.

Errors use `{ error: { code, message, requestId, timestamp } }`; production errors omit stacks. List endpoints will standardize cursor pagination before unbounded datasets are exposed. Sort/filter fields must be explicit allowlists. Request IDs accept a bounded incoming `x-request-id` or generate a UUID.

Money-moving commands require an `Idempotency-Key` and return persisted internal references. Provider-specific request/response shapes are never public DTOs. Customer and identity references are masked where displayed. Public configuration contains non-sensitive brand/application metadata only.
