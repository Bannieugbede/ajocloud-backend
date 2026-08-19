# Dojah

Identity verification provider for BVN, NIN/vNIN, and bank-account name inquiry.
Selected in [ADR-004](../../../docs/adr/ADR-004-identity-verification-provider-and-data-policy.md).

Enabled by setting `KYC_PROVIDER=dojah` together with `DOJAH_APP_ID` and
`DOJAH_SECRET_KEY`. Until credentials are issued, `KYC_PROVIDER=mock` is the
default and the mock provider serves every environment.

## Data handling

The raw BVN/NIN is passed as a call argument and sent to Dojah over TLS. It is
never persisted, logged, cached, or included in a thrown error. Transport errors
are caught and replaced, because the underlying error object can carry the
request URL, which holds the identifier in its query string.

Only the masked identifier, pass/fail, provider reference, and risk flags are
written to `kyc_checks`.

## Endpoints used

| Operation    | Path                        |
| ------------ | --------------------------- |
| BVN lookup   | `GET /api/v1/kyc/bvn/full`  |
| NIN lookup   | `GET /api/v1/kyc/nin`       |
| vNIN lookup  | `GET /api/v1/kyc/vnin`      |
| Bank list    | `GET /api/v1/general/banks` |
| Account name | `GET /api/v1/kyc/nuban`     |

Paths and response shapes must be confirmed against current Dojah documentation
when credentials arrive; they were written from the published API and are not
verified against a live account.
