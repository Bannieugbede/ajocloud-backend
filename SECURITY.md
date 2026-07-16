# Security policy

## Reporting

Report vulnerabilities privately to the project security owner; do not open a public issue containing exploit details or sensitive data. The owner should acknowledge, triage severity, contain exposure, patch, test, rotate affected credentials, and publish an appropriate advisory.

## Controls

- Secrets enter through validated runtime environment variables and must be managed by a production secret manager. `.env` is ignored.
- Authentication uses Argon2id passwords, short-lived signed access tokens, and hashed rotating refresh tokens. Reuse marks a session compromised.
- Authorization combines roles/permissions with organisation, group, user, and wallet ownership checks.
- Financial commands use integer minor units, unique references, serializable boundaries where needed, immutable balanced ledger entries, reversals, and idempotency records.
- Provider webhooks require adapter-level signature verification, replay-resistant provider event IDs, persistence before processing, and redacted logging. Real adapters remain blocked until reviewed.
- Pino redacts authorization, passwords, tokens, OTPs, hashes, and cookies. Audit metadata applies additional sensitive-key redaction.
- Dependency updates require lockfile review, CI checks, `bun audit`, and urgent remediation for exploitable high/critical findings.

Never log passwords, tokens, OTPs, card data, raw BVN/NIN, secret keys, or unredacted provider payloads. Production requires TLS, a trusted reverse proxy, strict CORS, network-isolated data services, encrypted backups, least-privilege database credentials, monitoring, rate-limit persistence, and an incident response runbook.
