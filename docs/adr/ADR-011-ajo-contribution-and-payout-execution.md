# ADR-011 — Ajo contribution collection and payout execution

- Status: Accepted
- Date: 2026-09-04
- Extends: [ADR-001](ADR-001-ajo-rotation-and-liquidity.md),
  [ADR-002](ADR-002-flexible-ajo-contribution-model.md),
  [ADR-010](ADR-010-webhook-ledger-posting.md)

## Context

The rotation, the schedule and the ledger all exist. What did not exist is the
step between them: nothing moved money from a member's wallet into a cycle, and
nothing paid a cycle out to the slot whose turn it was. `Contribution` and
`Payout` were models with no service behind them, so a locked group's schedule
described obligations nobody could discharge.

ADR-001 is unambiguous about the constraint this has to respect: the model "is
solvent per cycle only if every contribution is collected", the platform
"provides no liquidity float and never funds a shortfall", and default handling
"may delay/hold payout; it must not silently spend platform funds".

## Decision

### Group funds live in a per-group pool account

A new `FinancialAccountPurpose.AJO_GROUP_POOL` holds contributions between
collection and payout. One account per group per currency, created when the
group locks.

The pool is a liability: the money belongs to the members, not the platform. It
is deliberately not a wallet — `FinancialAccount.walletId` stays null, because a
group is not a person and must never acquire the withdraw, top-up or bill-pay
capabilities that hang off a wallet.

Rejected: paying each contribution directly to the recipient's wallet as it
arrives. It reads simpler, but it makes a partially collected cycle
indistinguishable from a completed one, and it gives the recipient spendable
money before the cycle is known to be solvent. Reversing that is far worse than
never having sent it.

### Contribution collection debits the member's wallet

One serializable transaction per contribution:

```
WALLET_AVAILABLE (member)   DEBIT   amount
AJO_GROUP_POOL   (group)    CREDIT  amount
```

No fee is charged on a contribution. The platform's fee is taken on deposit
(ADR-009), and charging again to move money that is already inside the platform
would be charging twice for one journey.

The wallet balance is re-read inside the transaction and the posting is refused
if it would overdraw. A member with insufficient funds gets a failed
contribution, not an overdrawn wallet: a negative member balance is a platform
float by another name, which ADR-001 forbids.

Partial payment is allowed and moves the schedule to `PARTIALLY_PAID`. Flexible
groups (ADR-002) collect in whole units, so a partial payment is a real state
rather than an error. `amountPaidMinor` is the sum of succeeded contributions,
and the schedule reaches `PAID` only when it equals `amountDueMinor`.

### Payout execution requires the cycle to be fully collected

A payout may execute only when **every** contribution schedule in that cycle is
`PAID` or `WAIVED`. Not most of them, and not merely enough of them to cover
the amount.

This is stricter than solvency alone, and deliberately so. The pool could hold
enough to pay the recipient while another member still owes — paying out then
spends a later recipient's money to cover this one's turn, which is exactly the
shortfall ADR-001 refuses. A cycle that is not fully collected moves its payout
schedule to `HELD`, and it stays there until the arrears are settled or an
administrator waives them.

`WAIVED` counts as collected because a waiver is an explicit decision that the
money will not arrive, recorded by someone accountable. It reduces the pool, so
the payout is still checked against the real balance before posting.

Execution posts:

```
AJO_GROUP_POOL   (group)     DEBIT   amount
WALLET_AVAILABLE (recipient) CREDIT  amount
```

The pool balance is re-read inside the same serializable transaction and the
posting is refused if it is short. Two guards rather than one: the schedule
check is the business rule, the balance check is the invariant. The first could
be wrong; the second cannot be, and it is the one that keeps the platform from
funding a difference.

No fee is charged on a payout either. A member receives the full pool for their
turn, which is what makes the rotation arithmetic in ADR-001 hold — `N` slots
paying `contributionMinor` yields exactly `N × contributionMinor`.

### Both are idempotent, and idempotency is derived from the schedule

Contribution: `ajo-contribution:{scheduleId}:{idempotencyKey}` where the key is
supplied by the caller. Payout: `ajo-payout:{payoutScheduleId}`, with no caller
input at all — a schedule has exactly one payout, so the schedule identifies it
completely.

Deriving the payout key from the schedule rather than from a request means a
retried, duplicated or replayed execution cannot pay a recipient twice, whatever
the caller does.

## Consequences

A group whose members do not all pay does not pay out. This is the honest
outcome of a model with no float, and it is visible: the payout schedule sits in
`HELD` with the arrears identifiable, rather than the platform quietly covering
the gap and discovering the hole later.

Contributions are collected from wallet balance, so a member must have funded
their wallet first. The deposit path (ADR-010) already works, so this is a real
journey rather than a blocked one, but it means "pay my contribution" is two
steps for a member with an empty wallet.

Default handling beyond `HELD` — penalties, removing a defaulting member,
redistributing their slot — is not decided here. The penalty models exist and
`PenaltyRule` is unused; that needs its own ADR, because forfeiting someone's
contributions is a rule about their money and not an implementation detail.

Multiple payout recipients per cycle remains blocked, unchanged from ADR-001.
