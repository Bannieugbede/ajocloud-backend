# ADR-004 — Identity verification provider and identity-data policy

- Status: Data policy accepted and in force. **Provider choice superseded by
  [ADR-005](ADR-005-monnify-as-single-financial-and-identity-provider.md)**:
  Monnify replaced Dojah on 2026-08-20. Read every mention of Dojah below as
  Monnify; the identity-data rules are unaffected by the swap.
- Date: 2026-08-19
- Supersedes: nothing. Extends [progressive KYC](../kyc.md).

## Context

The mobile account-creation step form reaches identity verification (personal
details, BVN or NIN, bank account) but stops at an introduction screen, because
no provider was chosen and no rule existed for handling identity numbers. This
ADR settles both so the steps can be implemented.

Nigerian identity verification means handing a government identifier to a
licensed verification provider and acting on its answer. The identifier — BVN or
NIN — is high-value personal data: a BVN links every bank account a person holds,
and both are permanent and non-reissuable. A breach cannot be remediated by
rotation the way a password can.

The product requirement was stated as "end-to-end encrypted BVN/NIN". Recorded
plainly: true end-to-end encryption is not achievable for this operation. The
server must transmit the identifier in plaintext to the verification provider,
because the provider is the party that performs the match. Any scheme where only
the user and the provider hold the key would exclude the server from a decision
it must make and audit. What is achievable is TLS in transit, a strict
non-persistence rule, and a minimal retained record — which is what this ADR
mandates.

## Options considered

### Provider

1. **Dojah.** Nigerian-focused identity provider covering BVN, NIN/vNIN, bank
   account inquiry, face match, and liveness under one integration and one
   contract. Already present in `env.schema.ts` and `docs/kyc.md` as the intended
   biometric provider.
2. **Monnify.** Already integrated for payments and bill payments. Offers some
   account/identity inquiry, but its identity coverage is narrower and
   `docs/kyc.md` requires verification of current capabilities before relying on
   it. Using it would split identity across two vendors.
3. **Both, split by check type.** Lowest per-check cost in principle, but doubles
   the contractual, latency, and reconciliation surface for an MVP.

### Identity-number storage

1. **Persist the raw identifier.** Simplest for re-checks and support. Creates a
   permanent, non-rotatable breach liability and is prohibited outright by
   `docs/kyc.md`.
2. **Persist encrypted with field-level keys.** Permitted by `docs/kyc.md` only
   with an approved purpose, access audit, retention, and deletion policy. No such
   purpose has been established: nothing in the MVP needs to re-read the number.
3. **Never persist; store mask plus result.** The identifier exists in process
   memory for the duration of one request. Only the masked value, pass/fail,
   provider reference, and risk flags are written.

## Decision

**Dojah is the identity verification provider** for BVN, NIN/vNIN, and bank
account name inquiry (option 1). Monnify remains the payments and bill-payment
provider and is not used for identity. This keeps one identity vendor, one
contract, and one audit trail, and matches the existing `KYC_PROVIDER` enum.

Selection stays behind the existing `KYC_PROVIDER` environment variable
(`mock` | `monnify` | `dojah`), defaulting to `mock`. The mock provider is the
default in every environment until Dojah credentials are issued, and the mock
never reports a real-world verification as passed for an unknown identifier.

**Raw identity numbers are never persisted** (option 3). Specifically:

- The identifier is accepted over TLS, held only for the lifetime of the request,
  passed to Dojah, and discarded. It is never written to the database, a log, a
  cache, a queue message, an error message, an audit payload, or an exception.
- What persists on `KycCheck` is: check type, provider name, provider reference,
  status, result code, masked identifier, safe result summary, risk flags,
  timestamps. This is exactly the field set `docs/kyc.md` already prescribes.
- Masking retains at most the last four characters
  (`maskIdentityValue`). A BVN or NIN is 11 digits, so `*******1234` is stored.
- No endpoint, admin screen, export, or support tool may return an unmasked
  identifier, because none is retained to return.

**Explicit consent is required and recorded.** A verification request must carry
an affirmative consent flag. Consent is persisted as a `UserConsent` row of type
`IDENTITY_VERIFICATION` with the policy version, before the provider is called.
A request without consent is rejected and no provider call is made.

**Name matching is advisory in Tier 2.** A mismatch between the provider's
returned name and the profile name raises a `NAME_MISMATCH` risk flag and routes
the profile to `REQUIRES_REVIEW`; it does not auto-reject. Automatic rejection on
fuzzy name comparison would exclude legitimate users with ordering, spelling, and
diacritic variations common in Nigerian names.

**Failure limits.** Five failed identity checks per user per rolling 24 hours,
after which further attempts are refused and the profile is routed to compliance
review. This bounds enumeration of identifiers against the provider.

**Tier promotion.** A passed BVN or NIN check plus a passed bank-account inquiry
plus complete personal details promotes the profile to `TIER_2`. `TIER_3`
requires face match and liveness, which are out of scope here and remain
unimplemented.

**The bank list is provider-sourced and cached.** Dojah supplies the bank list
with NIP codes; it is cached for 24 hours and served from cache on provider
failure. No hardcoded bank list is maintained in the repository, because a stale
list causes failed transfers.

## Consequences

Users cannot reach Tier 3, Food Coordinator approval, or high-value actions until
face match and liveness are implemented under a further ADR.

Support cannot look up a user's BVN or NIN, because it is not stored. Support
workflows must key on the masked value plus the provider reference, and any
re-verification requires the user to re-enter the number. This is a deliberate
trade: it is the property that makes a database breach not a mass identity
compromise.

Verification cannot function offline or in tests against the real provider. The
mock provider covers development and CI; no test asserts real-world identity.

Costs are per check and unbudgeted here. `docs/product-reference/kyc-cost-assumptions.md`
still holds: no price in this repository is approved configuration, and the
commercial agreement must be settled before production traffic.

Changing any rule above — persisting an identifier, auto-rejecting on name
mismatch, altering tier promotion, or switching provider — requires a new ADR or
an explicit update to this one.
