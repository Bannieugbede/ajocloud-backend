# ADR-005 — Monnify as the single payments, verification, and payout provider

- Status: Accepted
- Date: 2026-08-20
- Supersedes: the provider decision in
  [ADR-004](ADR-004-identity-verification-provider-and-data-policy.md). The
  identity-data policy in ADR-004 is unchanged and remains in force.

## Context

ADR-004 selected Dojah for identity verification one day ago, on the assumption
that credentials were being obtained for it. That assumption no longer holds:
the repository owner has directed that Monnify be used for all verification,
and that Dojah be removed from the codebase, environment, and compose file.

Monnify was already the payments and bill-payment provider. It also offers BVN
and NIN lookup, a bank list, and account name inquiry — the three verification
capabilities Tier 2 onboarding needs.

ADR-004 rejected Monnify for identity on the grounds that its identity coverage
is narrower than Dojah's and that `docs/kyc.md` required its current
capabilities be verified first. The narrowness is real and is recorded below as
a consequence, not waved away. The verification requirement is now the owner's
call to make, and they have made it.

## Decision

**Monnify is the single provider for payments, identity verification, and
payouts.** Dojah is removed entirely: the adapter, the `dojah` value in the
`KYC_PROVIDER` enum, the `DOJAH_BASE_URL` / `DOJAH_APP_ID` /
`DOJAH_SECRET_KEY` variables, their `superRefine` branch, their compose entries,
and their documentation.

`KYC_PROVIDER` becomes `mock | monnify`, still defaulting to `mock`. The mock
provider remains the default in every environment until Monnify credentials are
issued, and still passes only identifiers ending `0001`, so no environment can
mistake a development pass for a genuine check.

Verification requires `MONNIFY_BASE_URL`, `MONNIFY_API_KEY`, and
`MONNIFY_SECRET_KEY`. It deliberately does **not** require
`MONNIFY_CONTRACT_CODE` or `MONNIFY_WEBHOOK_SECRET`: those scope payment
collection and payout callbacks, not identity lookups, and requiring them would
block a verification-only deployment. The bill-payment branch still requires all
five, unchanged.

One vendor now means one set of credentials, one contract, one audit trail, and
one status page for every money and identity operation.

## What is unchanged

The identity-data policy of ADR-004 carries over verbatim and is not reopened:

- Raw BVN/NIN/account numbers are **never persisted**. The identifier lives in
  process memory for one request, goes to the provider over TLS, and is
  discarded. Only the masked value, pass/fail, provider reference, and risk
  flags are written.
- Explicit consent is recorded as a `UserConsent` of type
  `IDENTITY_VERIFICATION` **before** the provider call.
- Name matching is **advisory**: a mismatch raises `NAME_MISMATCH` and routes to
  `REQUIRES_REVIEW`. It never auto-rejects.
- Five failed identity checks per user per rolling 24 hours.
- Tier 2 requires personal details, a passed identity check, and a verified bank
  account.
- True end-to-end encryption remains unachievable for this operation, for the
  reason ADR-004 records: the server must send the plaintext identifier to the
  provider, because the provider performs the match. Swapping Dojah for Monnify
  changes nothing about this.

Because the `IdentityProvider` interface was already provider-agnostic, this
change is confined to one adapter, the module's `useFactory` selection, and
configuration. No KYC rule, endpoint, DTO, or database column changes.

## Consequences

- **vNIN is no longer supported.** Monnify has no vNIN endpoint. The adapter
  returns `UNSUPPORTED_IDENTITY_TYPE` rather than sending a 16-character token
  to an endpoint expecting 11 digits and reporting the rejection as a failed
  identity. `VerificationType.VNIN` stays in the enum for records already
  written and for a future provider. BVN and NIN both remain available, so no
  user is blocked from Tier 2.
- **Tier 3 is further away.** ADR-004 noted Dojah covers face match and liveness
  under the same contract. Monnify's biometric coverage is not established, so
  the Tier 3 ADR must now also settle whether Monnify can serve it or whether a
  second vendor returns for biometrics alone.
- **Concentration risk.** A Monnify outage now stops payments, payouts, and
  onboarding together, where the previous split would have left onboarding
  running during a payments incident. Accepted deliberately: the bank list is
  cached for 24 hours and served stale on refresh failure, which keeps account
  linking working through a short outage, and the alternative is a second
  contract and integration for an MVP.
- **Endpoint paths are unverified.** The adapter was written from Monnify's
  published API shape — Basic-auth login exchanged for a bearer token, responses
  wrapped in `requestSuccessful` / `responseBody`. The specific verification
  paths must be confirmed against current documentation when credentials arrive.
  Until then `KYC_PROVIDER=mock` is the default and nothing calls them.

## Alternatives considered

1. **Keep Dojah alongside Monnify.** Rejected: contradicts an explicit
   instruction, and doubles the contractual and reconciliation surface.
2. **Keep the Dojah adapter as dormant code behind the enum.** Rejected: the
   instruction was to remove it, and an unreachable adapter for a vendor with no
   contract is dead code that later readers must still evaluate. It remains in
   git history if it is ever needed again.
