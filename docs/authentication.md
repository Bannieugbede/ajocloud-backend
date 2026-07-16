# Authentication

Registration normalizes email, validates a Nigerian `+234` mobile number, records the current Terms
and Privacy consent versions, and hashes passwords using Argon2id (64 MiB, three iterations, one
lane). New users remain `PENDING_VERIFICATION` and receive no session until phone then email ownership
is verified.

Six-digit challenges expire after ten minutes, allow five attempts, and have a sixty-second resend
cooldown. Each digest is HMAC-SHA256 bound to its challenge ID; raw codes are passed only to the
selected delivery adapter and are never stored or logged. Resend invalidates the prior challenge.
Notification and delivery records contain masked destinations and challenge references, never codes.

Phone verification creates the email challenge. Email verification atomically consumes that
challenge, activates the account, writes an audit record, and creates the first session. Login returns
a short-lived JWT access token and a random refresh token. Only an HMAC-SHA256 digest of refresh
material is stored.

Refresh tokens rotate once. Reuse or a token-family mismatch marks the session compromised and revokes outstanding refresh records. Access-token validation checks signature, token type, active unexpired database session, and active user on every protected request. Generic login failures reduce account enumeration. Auth endpoints have tighter rate limits.

Development email/SMS delivery adapters accept verification messages without exposing codes. Real
production delivery, password reset, MFA, and device-management endpoints are not yet implemented.

Registration is Tier 1 account creation, not full KYC. Transaction and product limits are enforced independently through the progressive KYC policy; higher-risk actions may require step-up verification.
