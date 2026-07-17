# Notifications

## Provider architecture

Transactional delivery uses replaceable `EmailProvider` and `SmsProvider` boundaries. Development
can select console/mock adapters. Brevo selection uses the official `@getbrevo/brevo` v6 client with
a 15-second timeout and bounded retry behavior. Email and SMS both use the API key; `SMTP_URL` is
retained as an operational relay configuration but is not the active application transport.

Required Brevo settings are `BREVO_API_KEY`, a verified `BREVO_SENDER_EMAIL`,
`BREVO_SENDER_NAME`, and an approved `BREVO_SMS_SENDER`. The SMS Sender ID must satisfy Brevo's
length/character rules and may require country-specific approval. Never expose these settings in a
mobile/public environment.

## Templates

The code-owned version-1 catalog currently contains:

- Email verification and welcome.
- Password reset, password changed, and new-login alert.
- Ajo contribution due and payout sent.
- Food Ajo distribution ready.
- Akawo goal progress.
- Bill Payment receipt.
- SMS password reset template retained for the future recovery workflow; account verification is
  email-only.

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

Before production, approve Brevo commercially and legally, verify the sender domain, approve SMS
Sender IDs per target country, move credentials to a secret manager, configure balance/deliverability
alerts, and implement authenticated replay-resistant delivery webhooks. Scheduled reminders,
BullMQ retry/dead-letter processing, preference/quiet-hour enforcement, and remaining domain-event
orchestration are still roadmap work.
