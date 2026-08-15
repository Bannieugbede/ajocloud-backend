# Resend

Transactional email adapter. Selected with `EMAIL_PROVIDER=resend`; otherwise the console provider
in `modules/notifications/providers` logs instead of sending.

## Configuration

| Variable              | Required | Notes                                                     |
| --------------------- | -------- | --------------------------------------------------------- |
| `RESEND_API_KEY`      | yes      | Server-side key. Never ship to a mobile or public client. |
| `RESEND_SENDER_EMAIL` | yes      | Address on a domain verified in Resend (SPF/DKIM).        |
| `RESEND_SENDER_NAME`  | no       | Display name; defaults to `Ajo Cloud`.                    |
| `RESEND_BASE_URL`     | no       | Overrides the API host. Testing only.                     |

`env.schema.ts` requires the first two whenever `EMAIL_PROVIDER=resend`, so a misconfigured
deployment fails at boot rather than at first send.

## Design notes

`ResendClientService` calls `POST /emails` with `fetch` rather than the official SDK: one endpoint
does not justify the dependency or its transitive tree in the runtime image.

- Every send carries an `Idempotency-Key` (the notification dedupe key); Resend deduplicates
  retries of the same key for 24 hours.
- Requests time out after 15 seconds via `AbortSignal.timeout`.
- Transport and non-2xx errors raise `ServiceUnavailableException` with a generic message. Raw
  responses are never surfaced, because they can echo the request payload.
- The template ID is sent as a `template` tag, sanitised to the ASCII word characters and dashes
  that Resend allows in tag values.

Delivery webhooks are not implemented; see `docs/notifications.md` for the remaining production
work.
