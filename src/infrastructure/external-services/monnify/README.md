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

## Still blocked

The bill-payment adapter, and any future collection/payout adapter, remain
blocked until the repository owner supplies current official documentation and
confirms the commercial agreement. Review token lifetime, exact endpoints,
request and response schemas, idempotency behaviour, timeout semantics, retry
guidance, webhook signature algorithm and raw-body requirements, event
identifiers, status mapping, rate limits, and redaction requirements before
implementation.
