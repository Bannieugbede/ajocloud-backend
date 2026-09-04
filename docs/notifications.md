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

Push goes through Expo. `PUSH_PROVIDER=expo` selects `ExpoPushProvider`, which posts to
`https://exp.host/--/api/v2/push/send` in batches of at most 100 — Expo's documented limit. Expo
answers with one ticket per token, so a batch is not all-or-nothing: a single dead token must not
stop everyone else's notification. Only `DeviceNotRegistered` is treated as permanent, and that
token is cleared from the device row; every other failure keeps the token, because dropping a live
one would silently stop a working device from ever being reached again. Delivery receipts are not
polled — Expo advises checking them about fifteen minutes later, which belongs to a worker rather
than a request a user is waiting on.

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

## Devices

Every installation registers itself at sign-in through `POST /api/v1/devices`. Registration happens
in the mobile app's single session-saving path, so no authentication route — password, OTP or
Google — can forget to announce the device.

A device is identified by an opaque fingerprint the app generates once and keeps in secure storage.
It is deliberately not derived from hardware identifiers: those are restricted on both platforms,
change across reinstalls anyway, and would make the record more identifying than it needs to be.

A push token is supplied when permission is granted and omitted when it is not. **A device with no
token is still registered**, because the record is what a security review of the account reads, and
a device nobody knows about cannot be reviewed or signed out. Omitting the token on a later call
leaves any stored one alone, so a registration made before permission resolves cannot wipe a working
token.

A push token identifies an installation, not a person. When the same token arrives under a different
device or user — a restored backup, or a handset that changed hands — any older claim on it is
released first, because two rows holding one token would both look deliverable and one would be
sending another person's notifications to that phone.

`GET /api/v1/devices` lists a user's installations and never returns the token itself: it is an
address for reaching the device and has no business on a screen. `DELETE /api/v1/devices/:deviceId`
stops notifications reaching one device but keeps the row, since it is evidence the installation was
signed in.

## In-app notifications

`Notification` rows on the `IN_APP` channel back a feed at `GET /api/v1/notifications`, with
`POST /api/v1/notifications/:id/read` and `POST /api/v1/notifications/read-all`. The feed reads only
`IN_APP` rows — the same table records email and push attempts, but those are delivery records
rather than things to show a user, and listing them would surface an already-received email as an
unread item. Re-marking a read notification keeps its original timestamp rather than rewriting when
the user actually saw it.

Title and body are rendered once at send time and stored, so the feed never re-renders a template
whose version may since have changed and shows the user different words from the ones they were
sent.

**The in-app entry is written even when push fails or no device is reachable.** Push is a prompt to
open the app, not the notification itself; delivering only by push would mean someone who declined
permission never learns their payout arrived.

Push payloads carry only a deep link for routing the tap. They travel through Apple's and Google's
infrastructure and appear on a lock screen, so nothing sensitive goes in them. The link is an in-app
path, never a URL, and the client refuses anything outside its known route prefixes — a
server-supplied link the client follows blindly is an open redirect.

Short-form copy lives in a separate catalogue from the email templates: a push body is read at a
glance on a lock screen, and an email subject makes a poor notification while an email body makes an
impossible one. Security templates have no short-form entry on purpose — a push saying someone
signed in is useful, but a recovery link must go to a mailbox the attacker does not already hold.

## Preferences

`GET` and `PUT /api/v1/users/me/notification-preferences` read and write a user's own settings.
The read returns the whole topic-by-channel grid with defaults filled in, so a client never has to
know the catalogue or guess a default.

Topics are a closed set defined in `src/modules/notifications/domain/notification-topics.ts`, not
free text: `NotificationPreference.topic` is a plain string column, so a client typo would
otherwise store a row that looks saved and governs nothing. Every template is mapped to a topic or
to the always-send set, and `topicForTemplate` throws for anything unmapped — a template added
without being classified fails in tests rather than silently becoming unsuppressible.

**Security and account-recovery messages are always sent.** Verification, sign-in codes, password
reset and change, new-login alerts, device additions, account locks, and staff invites carry no
topic, are never held by quiet hours, and are deliberately absent from the catalogue: someone who
had switched off reset mail could not recover their account, a login alert delivered eight hours
late is not an alert, and offering a switch that does nothing is worse than offering none.

Preferences are opt-out, so an absent row means the user has not declined. Quiet hours are stored
as minutes from midnight and evaluated in the user's own timezone through `Intl`, so DST and any
future offset change are handled by the platform's tz database rather than a hardcoded offset. Both
ends of a window are set together; one end alone describes no window and is rejected.

A suppressed message writes no `Notification` row. The record describes delivery, and a message that
was never attempted has none; storing one would also consume the dedupe key, so a later permitted
send of the same event would be swallowed as a duplicate. `sendEmail` and `sendSms` report
`SUPPRESSED` distinctly from `FAILED`, since nothing went wrong and a caller must not retry.

All four channels are configurable. `SMS` preferences are recorded and honoured even though no
hosted SMS provider is selected yet, so nothing sends on that channel today.

## Persistence and safety

Every attempted message creates a `Notification` with a template key/version, safe redacted payload,
and deterministic dedupe key. Successful sends store only the provider name/message ID and sent time.
Failures store a generic code/reason without raw SDK responses. OTP values are rendered only in
memory and never enter notification payloads, logs, or analytics.

Account verification uses email only, and activation triggers a welcome email. Verification delivery
failure is returned to the auth flow; welcome failure is recorded but does not invalidate an already
verified account/session.

## Product events

Three domain events emit product notifications: `ajo-payout-sent` when a payout
executes, `wallet-funded` when a deposit settles, and `kyc-approved`/`kyc-rejected`
when a compliance review concludes.

Each is sent **after** its transaction commits, never inside it: a notification
sent from within announces money that can still roll back, and it cannot be
unsent. None is awaited, because the money has already moved — a push provider
being down must not make a completed payout or a settled deposit look failed to
its caller.

Dedupe keys come from the thing that happened (the payout id, the payment intent
id, the decision instant) rather than from the request, so a redelivered webhook
or a retried execution cannot notify twice.

Copy is written for a lock screen. The wallet-funded message quotes the credited
amount rather than the gross, so it matches the balance the recipient will see;
the KYC messages carry none of the reviewer's reason, which is written for an
internal audit trail. `formatMoney` and `formatDueDate` in
`domain/notification-money.ts` render amounts and dates — the latter in the
group's own timezone, so a contribution due on the 1st in Lagos is not announced
as due on the 31st.

A send is fire-and-forget, so one lost to a transient failure is not retried.
The outbox table exists and a worker consuming it is the durable answer.

## Remaining production work

Before production, verify the sender domain in Resend (SPF/DKIM records), move credentials to a
secret manager, configure deliverability alerts, and implement authenticated replay-resistant
delivery webhooks. Selecting an SMS provider remains open work. Scheduled reminders,
BullMQ retry/dead-letter processing, and the remaining domain-event emitters — contribution
reminders and Akawo progress need a scheduler rather than a request, and Food distribution and
Bill Payment have templates but no emitter — are still roadmap work.
