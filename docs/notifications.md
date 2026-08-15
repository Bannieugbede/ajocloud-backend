# Notifications

## Provider architecture

Transactional delivery uses replaceable `EmailProvider` and `SmsProvider` boundaries. Development
can select console/mock adapters. Selecting `EMAIL_PROVIDER=resend` routes email through the Resend
REST API over `fetch` with a 15-second timeout; the single `POST /emails` call does not justify an
SDK dependency. Every send carries an `Idempotency-Key`, which Resend deduplicates for 24 hours.

Required Resend settings are `RESEND_API_KEY`, a verified `RESEND_SENDER_EMAIL`, and
`RESEND_SENDER_NAME`. `RESEND_BASE_URL` overrides the API host for testing only. Never expose these
settings in a mobile/public environment.

No hosted SMS provider is wired. `SMS_PROVIDER` accepts `mock` only, which logs instead of sending;
the `SmsProvider` boundary and the `SMS` notification channel stay in place so a provider can be
added without a schema change.

## Templates

The code-owned version-1 catalog currently contains:

- Email verification and welcome.
- Password reset, password changed, and new-login alert.
- Ajo contribution due and payout sent.
- Food Ajo distribution ready.
- Akawo goal progress.
- Bill Payment receipt.
- SMS password reset template retained for the future recovery workflow; it renders through the
  mock adapter until an SMS provider is selected. Account verification is email-only.

Templates provide responsive inline HTML and plain text, escape user-controlled HTML variables,
and use the Ajo Cloud blue/teal brand. Password recovery and product-event templates are ready for
their future workflows; no endpoint or successful delivery is faked before those domain events exist.

## Persistence and safety

Every attempted message creates a `Notification` with a template key/version, safe redacted payload,
and deterministic dedupe key. Successful sends store only the provider name/message ID and sent time.
Failures store a generic code/reason without raw SDK responses. OTP values are rendered only in
memory and never enter notification payloads, logs, or analytics.

Account verification uses email only, and activation triggers a welcome email. Verification delivery
failure is returned to the auth flow; welcome failure is recorded but does not invalidate an already
verified account/session.

## Remaining production work

Before production, verify the sender domain in Resend (SPF/DKIM records), move credentials to a
secret manager, configure deliverability alerts, and implement authenticated replay-resistant
delivery webhooks. Selecting an SMS provider remains open work. Scheduled reminders,
BullMQ retry/dead-letter processing, preference/quiet-hour enforcement, and remaining domain-event
orchestration are still roadmap work.
