# ADR-006 — Monnify webhook ingestion and sandbox verification fallback

- Status: Accepted
- Date: 2026-08-20
- Extends [ADR-005](ADR-005-monnify-as-single-financial-and-identity-provider.md).
  Does not change the identity-data policy in
  [ADR-004](ADR-004-identity-verification-provider-and-data-policy.md).

## Context

Monnify test credentials are now configured. Monnify's dashboard requires a
callback URL per event type, and seven were requested: transaction completion,
refund completion, disbursement, settlement, wallet activity, low balance, and
bill payment. None existed — the repository had no webhook route, controller,
signature check, or raw-body capture of any kind.

Two facts shape this decision.

**Webhooks are unauthenticated public endpoints carrying money instructions.**
Anyone on the internet can POST to them. A webhook that credits a wallet on
request is a funds-drain vulnerability, so the signature check is the entire
security boundary and must be correct before the route is useful.

**The keys are test keys.** Monnify's sandbox does not serve live BVN/NIN data.
Some verification calls will fail or return synthetic values regardless of
correct integration, and mobile testing must not be blocked by that.

## Decision

### 1. One route per event type, one shared verification path

Seven routes under `POST /api/v1/webhooks/monnify/*`, one per dashboard entry,
so each URL can be registered and disabled independently and logs attribute
traffic to a specific event. All seven share one guard, one signature check, and
one persistence path; the route only names the expected event family.

### 2. Signature verification is mandatory and constant-time

Monnify signs the **raw request body** with HMAC-SHA512 keyed on the merchant
secret, sent as `monnify-signature`. Therefore:

- Fastify must capture the unparsed body for these routes. A signature computed
  over a re-serialized object is not the signed bytes: key order, whitespace,
  and numeric formatting all differ, and the check would fail or, worse, be
  weakened to make it pass.
- Comparison uses `timingSafeEqual` on equal-length buffers.
- A missing, malformed, or mismatched signature is rejected with 401 and
  recorded. The payload of a rejected request is **never** trusted, parsed into
  a domain object, or acted on.
- `MONNIFY_WEBHOOK_SECRET` is required whenever webhooks are enabled. If it is
  absent the routes return 503 rather than accepting unverified traffic. There
  is no "skip verification in development" switch: such a flag is one
  misconfiguration away from accepting forged money instructions in production.

### 3. Replay and duplicate protection via the existing inbox

Every accepted event is written to `PaymentWebhookEvent`, whose
`@@unique([provider, providerEventId])` makes redelivery a no-op. Monnify
retries on non-2xx, so duplicates are expected, not exceptional. Processing is
therefore: record first, then act; a second delivery of the same event finds the
row and returns 200 without reprocessing.

Events also carry a timestamp check: anything older than
`WEBHOOK_TIMESTAMP_TOLERANCE_MS` (5 minutes) is rejected as a replay, provided a
timestamp is present.

### 4. Acknowledge fast, process idempotently

The endpoint verifies, records, and returns 200 immediately. A provider that
does not get a prompt 200 retries, and a slow handler turns one event into a
retry storm. Domain processing happens behind the recorded event, keyed on the
event id, so it can be retried without double-crediting.

**No webhook mutates a wallet balance directly.** Money movement goes through
`LedgerService`, which is idempotent on `idempotencyKey` and enforces balanced
double-entry postings. This ADR does not introduce a second path to money.

### 5. Sandbox verification falls back to the mock, loudly

`KYC_SANDBOX_FALLBACK=true` (default `false`) makes a Monnify verification
failure that is attributable to sandbox limitations — not a genuine "identity
not found" — fall through to `MockIdentityProvider`, so mobile testing proceeds.

Guard rails, because this is deliberately a weakening of a verification path:

- **Refused outright when `NODE_ENV=production`.** Validation fails at boot; the
  process does not start. A fallback that can be switched on in production is a
  way to mark arbitrary identities as verified.
- Every fallback result is flagged `SANDBOX_FALLBACK` in the check's risk flags
  and the check's provider records `mock`, not `monnify`. A sandbox pass is
  therefore distinguishable from a real one in the database forever, and Tier 2
  promotions granted this way can be found and revoked.
- The fallback applies only to provider-side failures (`503`, unsupported in
  sandbox). A definitive "this identity does not exist" answer is a real answer
  and is **not** overridden.

## Consequences

- Seven URLs to register in the Monnify dashboard, listed in the Monnify README.
- Fastify gains a raw-body content-type parser scoped to the webhook route
  prefix. It does not change body handling for any other route.
- Webhook routes are exempt from the global 120/min throttle and given their own
  higher limit: a settlement batch can legitimately burst, and throttling a
  provider into retries makes duplicate delivery more likely, not less.
- The CSRF guard already passes requests with no session cookie, so webhooks
  need no exemption there. Verified by test rather than assumed.
- Sandbox fallback creates KYC records that passed without a real check. This is
  accepted only because it cannot be enabled in production and is permanently
  labelled. Before the first production release, every check bearing
  `SANDBOX_FALLBACK` must be re-verified or the account demoted; this is
  recorded as a release blocker in `ROADMAP.md`.
- Settlement, refund, and disbursement events are recorded but **not** yet
  posted to the ledger: the account mapping and fee treatment for each is a
  financial rule that this ADR does not settle. They are stored with status
  `PENDING` and are visible for reconciliation. Posting them requires a further
  ADR, per the standing rule that financial behaviour is never changed silently.

## Alternatives considered

1. **One catch-all webhook route.** Fewer URLs, but the dashboard wants one per
   event, and a single route cannot be disabled per event type during an
   incident.
2. **Verify signatures over the parsed body.** Simpler, and wrong: it does not
   verify what Monnify signed.
3. **Process synchronously inside the request.** Rejected: slow handlers cause
   provider retries and duplicate processing.
4. **Auto-approve all sandbox verifications.** Rejected: it would make every
   test account indistinguishable from a verified one, with no way to find them
   later.
