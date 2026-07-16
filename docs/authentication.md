# Authentication

Registration normalizes email and hashes passwords using Argon2id (64 MiB, three iterations, one lane). Login returns a short-lived JWT access token and a random refresh token. Only an HMAC-SHA256 digest of refresh material is stored.

Refresh tokens rotate once. Reuse or a token-family mismatch marks the session compromised and revokes outstanding refresh records. Access-token validation checks signature, token type, active unexpired database session, and active user on every protected request. Generic login failures reduce account enumeration. Auth endpoints have tighter rate limits.

Email/phone verification delivery, password reset, MFA, and device-management endpoints are not yet implemented.
