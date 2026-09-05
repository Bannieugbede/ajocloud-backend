# ADR-012 — Referral qualification and reward issuance

- Status: Accepted
- Date: 2026-09-05
- Extends: [ADR-001](ADR-001-ajo-rotation-and-liquidity.md),
  [ADR-009](ADR-009-platform-fee-model.md),
  [ADR-010](ADR-010-webhook-ledger-posting.md)

## Context

The referral tables have existed since the initial migration — `Referral`,
`ReferralReward`, `ReferralCampaign`, `ReferralQualification` — along with a
pure `referralQualifies()` rule and its tests. Nothing used any of it. There was
no module, no route, and no code path that could move a referral out of
`PENDING`, so the schema described a programme that could not run.

This matters more than an unused table normally would, because the home screen
shows a rewards balance. Rendering a figure with nothing behind it would state a
number the ledger cannot support.

A referral reward is different in kind from every other posting in this system.
Contributions, payouts, transfers and bill payments all move money that already
belongs to a member. A reward **issues** money: it credits a user's wallet
against the platform's own funds. That makes it the one place where a bug does
not merely misroute value but creates it, and it is why this decision needs to
be written down before the code exists.

## Decision

### Qualification requires a settled deposit

A referral qualifies when the referred user completes their first deposit and
that deposit settles. Registration alone does not qualify — ADR-009 already
observes that an account costs nothing to create, and paying for one invites
exactly the farming this programme must not fund. A settled deposit proves a
real person moved real money.

Qualification is evaluated inside the deposit's settlement transaction, from
committed state, so a reward can never be based on a credit that later rolls
back.

### The reward is posted, not calculated at read time

Every reward is a ledger posting:

```
DR  Platform referral reward expense    ₦1,000
  CR  Referred user's wallet available   ₦1,000
```

`FinancialAccountPurpose.REFERRAL_REWARD_EXPENSE` already exists for this and
needs no migration. It is an expense account: the debit records what the
programme cost, and that cost stays legible as its own line rather than netting
silently against fee revenue. A reader can always answer "what have referrals
cost us" by reading one account.

The rewards balance the app displays is the sum of `RELEASED` rewards. It is read
from posted rows, never recomputed from campaign rules, so the number on the
screen and the number in the ledger cannot disagree.

### Campaign terms are data, not code

Amount, cap, qualifying event and required KYC tier live in `ReferralCampaign`
rows. The launch campaign is ₦1,000 per qualified referral, capped at 20 per
referrer — a maximum exposure of ₦20,000 per referring account. Changing those
terms is a data change; it must not require a deploy, and a campaign already
paid against must not be edited, so a change is a new `version` rather than an
update in place.

A campaign is only eligible while `status = ACTIVE` and the qualifying moment
falls within `effectiveAt`/`expiresAt`. A referral that qualifies outside that
window earns nothing: the terms in force are the terms at the qualifying event,
not the terms today.

### Four controls gate every award

All are checked before the posting, and all reject rather than defer:

1. **Self-referral and duplicate identity.** The same person on both sides, or a
   referred user whose verified identity is already attached to another account.
   `referralQualifies()` already models both.
2. **Verified identity.** The referred user must hold at least the campaign's
   `requiredKycTier`. A reward is only ever paid to a person the platform has
   identified.
3. **One reward per referral, ever.** Enforced by the existing unique constraint
   on `ReferralReward.idempotencyKey`, derived from the referral id and campaign
   version — from state, not from the request, so a retry, a duplicate webhook
   and a concurrent settlement all collapse onto the same row.
4. **The cap.** Released rewards for the referrer are counted inside the same
   serializable transaction that inserts the new one, so two deposits settling
   at once cannot both pass a check for the last remaining slot.

### A reversed deposit reverses the reward

If the deposit that qualified a referral is later reversed or charged back, the
reward is reversed with a compensating ledger entry and the row moves to
`REVERSED`. Without this, deposit-then-withdraw is a money pump: fund an
account, collect ₦1,000, withdraw, repeat.

The reversal is a new posting, never an edit or deletion of the original — the
ledger is append-only, and the fact that a reward was paid and then clawed back
is itself something the audit trail must retain.

## Consequences

The programme cannot pay for a signup, cannot pay twice for one referral, cannot
exceed its per-referrer cap under concurrency, and cannot keep paying for a
deposit that was undone. Its total cost is bounded by campaign terms and legible
in one account.

The reward lands in the wallet's available balance, so it is immediately
spendable and immediately withdrawable. That is deliberate — a reward the user
cannot use is not a reward — but it does mean the anti-farming controls above
are the only thing standing between the programme and a withdrawal, which is why
all four are mandatory rather than configurable.

Rewards are credited without the referred user's consent to a balance change
they did not initiate. This is safe in the credit direction and only in the
credit direction: nothing in this ADR permits a debit to a user's wallet from
the referral path.

### What this does not decide

Whether the referrer, the referred user, or both are paid. This ADR pays the
**referrer** only; paying both doubles the exposure per referral and is a
commercial decision that should be taken explicitly rather than inherited from
an implementation detail.

Referral campaign administration — creating, activating and expiring campaigns —
has no route here. Campaigns are seeded and changed by migration until an admin
surface is decided, because an endpoint that can activate a money-issuing
campaign needs an authorization model of its own.
