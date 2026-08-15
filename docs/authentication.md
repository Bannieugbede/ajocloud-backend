# Authentication

Registration normalizes email, records the current Terms and Privacy consent versions, and hashes
passwords using Argon2id (64 MiB, three iterations, one lane). New users remain
`PENDING_VERIFICATION` and receive no session until email ownership is verified. A phone number is
not collected or verified during account creation.

Six-digit challenges expire after ten minutes, allow five attempts, and have a sixty-second resend
cooldown. Each digest is HMAC-SHA256 bound to its challenge ID; raw codes are passed only to the
selected delivery adapter and are never stored or logged. Resend invalidates the prior challenge.
Notification and delivery records contain masked destinations and challenge references, never codes.

Registration creates and dispatches the email challenge. Email verification atomically consumes
that challenge, activates the account, writes an audit record, and creates the first session. Login
uses email and password and returns a short-lived JWT access token plus a random refresh token. Only
an HMAC-SHA256 digest of refresh material is stored.

Refresh tokens rotate once. Reuse or a token-family mismatch marks the session compromised and revokes outstanding refresh records. Access-token validation checks signature, token type, active unexpired database session, and active user on every protected request. Generic login failures reduce account enumeration. Auth endpoints have tighter rate limits.

The selected email adapter sends account verification and the welcome message through Resend
transactional email. Every attempt is persisted with a deterministic dedupe key and provider message
ID. Raw codes exist only during rendering/provider dispatch and are never stored in notification
payloads or logs. Password-reset templates exist, but password recovery, MFA, and device-management
endpoints are not yet implemented.

Registration is Tier 1 account creation, not full KYC. Transaction and product limits are enforced independently through the progressive KYC policy; higher-risk actions may require step-up verification.
