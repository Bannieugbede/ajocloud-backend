# ADR-015 — Staged verification gates what a member may do

- Status: Accepted
- Date: 2026-09-28
- Extends: [ADR-004](ADR-004-identity-verification-provider-and-data-policy.md),
  [ADR-005](ADR-005-monnify-as-single-financial-and-identity-provider.md)

## Context

Tiers existed but nothing enforced them: anyone could create a group, collect
money from members, or withdraw straight after sign-up. The product needs
verification in three visible stages, with each capability behind one of them,
enforced by the server as well as shown in the apps.

## Decision

Three stages, strictly ordered:

| Stage        | Requires                                                         | Unlocks                                       |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------- |
| 1 — Account  | Verified sign-up; date of birth, gender, occupation              | Joining groups and pools; every payment       |
| 2 — Identity | Transaction PIN; NIN verified with Monnify; NIN slip/card upload | Withdrawals; sending money to another member  |
| 3 — Address  | Residential address matching the NIN record                      | Creating and administering groups; collecting |

- **Evidence, not tier, decides.** `readKycFacts` reads the evidence and
  `completedLevel` counts stages on every gated request. The stored tier is
  kept in step for reports, but never grants anything alone. A reviewer
  rejection counts as no stages.
- **Enforcement** is `@RequireKycStage(action)` on each route. It returns 403
  with the code `KYC_STAGE_REQUIRED` and `details.requiredStage`. The action
  table `KYC_ACTION_STAGES` is also returned by `GET /kyc/status`, so the apps
  gate on the same list. A unit test pins every gated route.
- **Counterparties:** joining a group or pool, or paying a pool due, is refused
  unless the group's admin is at stage 3. This covers groups created before this
  ADR.
- **NIN:**
  - Only a NIN or vNIN counts; a BVN is still accepted but counts towards no
    stage.
  - A name or date-of-birth mismatch holds the check for a reviewer instead of
    passing it.
  - One verified NIN per account.
- **Document:**
  - JPEG, PNG or PDF, at most 700 KiB, checked against its magic bytes.
  - Stored AES-256-GCM encrypted in `verification_documents.ciphertext`, under
    a key derived with HKDF from `TOKEN_PEPPER`. This holds until object
    storage exists.
  - Replaceable until stage 2 completes.
  - Each reviewer view is audited.
- **Address:**
  - The NIN check stores the record's address, when Monnify returns one, in
    `resultSummary`. The address typed at stage 3 is compared against it: the
    state and every number must match, and 60% of the street words must.
  - With no address on record, the check waits for a reviewer, who compares
    against the uploaded document.
  - Failures share the identity attempt limit.
- **Review:**
  - Approval passes the held checks the granted tier rests on.
  - Rejection or an information request fails them.
  - The tier is then recomputed from the evidence.

## Consequences

- Migration `20260928120000_kyc_stages` resets every profile to Tier 1 and level 0. No existing profile can hold a NIN document or matched address, so no one
  keeps Tier 2 or 3. Members must complete the stages again, and groups whose
  admins have not reached stage 3 stop taking members and dues until they do.
- Monnify's NIN response is not documented to include an address. Until it is
  confirmed, stage 3 may route every member to manual review.
- Mock provider: NINs ending `0001` pass with the address `1 Mock Street,
Ikeja, Lagos`, and ones ending `90001` pass with no address.
