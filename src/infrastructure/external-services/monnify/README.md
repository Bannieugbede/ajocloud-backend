# Monnify integration boundary

Monnify is the single provider for **payments, identity verification, and
payouts** ([ADR-005](../../../docs/adr/ADR-005-monnify-as-single-financial-and-identity-provider.md)).
Dojah was removed on 2026-08-20; its adapter remains in git history only.

| Capability                      | Adapter                            | State                              |
| ------------------------------- | ---------------------------------- | ---------------------------------- |
| Identity (BVN, NIN)             | `monnify-identity.provider.ts`     | Implemented; paths need confirming |
| Bank list, account name         | `monnify-identity.provider.ts`     | Implemented; paths need confirming |
| Bill payments                   | `monnify-bill-payment.provider.ts` | Blocked pending official specs     |
| Collections, transfers, payouts | not yet written                    | Blocked pending official specs     |

## Selection

Each capability is selected independently, all defaulting to `mock`:

- `KYC_PROVIDER=monnify` — needs `MONNIFY_BASE_URL`, `MONNIFY_API_KEY`,
  `MONNIFY_SECRET_KEY`.
- `BILL_PAYMENT_PROVIDER=monnify` — additionally needs `MONNIFY_CONTRACT_CODE`
  and `MONNIFY_WEBHOOK_SECRET`.
- `PAYMENT_PROVIDER=monnify` — reserved; no adapter is wired yet.

The contract code and webhook secret are not required for verification, because
they scope collection and payout callbacks rather than identity lookups.

## Authentication

Monnify issues a bearer token from a Basic-authenticated `POST /api/v1/auth/login`.
The identity adapter caches that token until 60 seconds before it expires and
shares one login round trip across concurrent callers.

## Data handling

The raw BVN/NIN is passed as a call argument and sent to Monnify over TLS. It is
never persisted, logged, cached, or included in a thrown error. Transport errors
are caught and replaced, because the underlying error object can carry the
request URL or body, which hold the identifier. The same applies to the login
call, whose error can carry the `Authorization` header.

Only the masked identifier, pass/fail, provider reference, and risk flags are
written to `kyc_checks`.

## Endpoints used by the identity adapter

| Operation    | Path                                          |
| ------------ | --------------------------------------------- |
| Login        | `POST /api/v1/auth/login`                     |
| BVN lookup   | `POST /api/v1/vas/bvn-details`                |
| NIN lookup   | `POST /api/v1/vas/nin-details`                |
| Bank list    | `GET  /api/v1/banks`                          |
| Account name | `GET  /api/v1/disbursements/account/validate` |

**These paths are unverified.** They were written from Monnify's published API
shape and have not been exercised against a live account. Confirm each path,
request payload, and response body against current documentation when
credentials arrive. Until then `KYC_PROVIDER=mock` is the default and none of
them are called.

vNIN has no Monnify endpoint. The adapter returns `UNSUPPORTED_IDENTITY_TYPE`
rather than sending a 16-character token to the 11-digit NIN endpoint.

## Webhook callback URLs

Register these in the Monnify dashboard. Every path is
`POST {API_BASE}/api/v1/webhooks/monnify/...` and returns `200 {"received":true}`.
Replace `{API_BASE}` with your deployed origin.

| Dashboard event              | Callback URL                                                |
| ---------------------------- | ----------------------------------------------------------- |
| Transaction completion       | `{API_BASE}/api/v1/webhooks/monnify/transaction-completion` |
| Refund completion            | `{API_BASE}/api/v1/webhooks/monnify/refund-completion`      |
| Disbursement                 | `{API_BASE}/api/v1/webhooks/monnify/disbursement`           |
| Settlement                   | `{API_BASE}/api/v1/webhooks/monnify/settlement`             |
| Wallet Activity Notification | `{API_BASE}/api/v1/webhooks/monnify/wallet-activity`        |
| Low Balance Notification     | `{API_BASE}/api/v1/webhooks/monnify/low-balance`            |
| Bills Payment                | `{API_BASE}/api/v1/webhooks/monnify/bills-payment`          |

One route per event so each can be registered, disabled during an incident, and
traced independently.

Enable with `MONNIFY_WEBHOOKS_ENABLED=true`, which requires
`MONNIFY_WEBHOOK_SECRET`. While disabled every route returns 503, so a URL
registered before the secret is set fails closed rather than accepting
unverified traffic.

### Verification

Each delivery must carry a `monnify-signature` header holding the hex
HMAC-SHA512 of the **raw request body**, keyed on the merchant secret. The
signature is checked in constant time against the exact bytes received; a
mismatch is a 401 and the payload is never parsed into a domain object or acted
on. There is no development bypass — see ADR-006 for why.

### Delivery semantics

- Redelivery is expected. Events are deduplicated on
  `(provider, providerEventId)`, so a repeat is acknowledged without being
  reprocessed.
- Events older than 5 minutes are recorded as `FAILED` rather than acted on.
- The endpoint acknowledges immediately; nothing slow runs inside the request,
  because a provider that waits will retry.
- **No webhook moves money yet.** Events are recorded for reconciliation.
  Posting settlement, refund, and disbursement events to the ledger is a
  financial rule that needs its own ADR, per the standing rule that financial
  behaviour is never changed silently.

## Sandbox verification with test keys

Monnify's sandbox cannot serve live BVN/NIN data. Setting
`KYC_SANDBOX_FALLBACK=true` lets a provider-side failure fall through to the
mock provider so mobile testing completes.

- **Refused in production**: environment validation fails, so the process will
  not start with it enabled.
- Only provider-side failures fall back. A definitive "identity not found" is a
  real answer and is returned unchanged.
- Every fallback result is flagged `SANDBOX_FALLBACK` and attributed to `mock`,
  so it stays distinguishable from a genuine check forever.
- The mock stays strict: identifiers must end in `0001` to pass, so testers use
  known values rather than anything being accepted.

Find every account promoted this way before release with:

```sql
-- "riskFlags" is a JSONB array; identifiers are camelCase and must be quoted.
SELECT c.id, p."userId", c.type, c.provider, c."createdAt"
FROM kyc_checks c
JOIN kyc_profiles p ON p.id = c."kycProfileId"
WHERE c."riskFlags" @> '["SANDBOX_FALLBACK"]'::jsonb;
```

## Still blocked

The bill-payment adapter, and any future collection/payout adapter, remain
blocked until the repository owner supplies current official documentation and
confirms the commercial agreement. Review token lifetime, exact endpoints,
request and response schemas, idempotency behaviour, timeout semantics, retry
guidance, webhook signature algorithm and raw-body requirements, event
identifiers, status mapping, rate limits, and redaction requirements before
implementation.
