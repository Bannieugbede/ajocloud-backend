# ADR-007 — Akawo group pools as a product distinct from personal goals

- Status: Accepted for MVP data model and collection rules
- Date: 2026-09-02

## Context

Two different products have been called "Akawo". The implemented one is personal
savings: a `SavingsGoal` owned by one `userId`, with schedules, contributions and
withdrawals. The one in the product brief is a **collection pool**: an organiser
— the worked example is a course representative — creates a pool, members join
with a code and identify themselves by full name and a membership reference such
as a matric number, each member sees what they owe, pays, and the organiser
exports the record as a PDF.

These are not variants of one model. A personal goal has one owner and no
members, no join code, no per-member obligation, and no organiser view of other
people's money. A pool has all five. Forcing them into `SavingsGoal` would mean a
nullable owner, a members table that is meaningless for most rows, and an
ownership check that is one bug away from showing one person another's balance.

## Options considered

1. **Extend `SavingsGoal` with optional group fields.** Cheapest to write and the
   worst to own: every owner-scoped query in the existing module would need to
   learn a second authorisation rule, and the ones not updated would silently
   leak.
2. **Separate models under the Akawo boundary.** A pool, its members, and their
   dues are their own aggregate. Personal goals keep their existing semantics and
   queries unchanged.
3. **Reuse the Ajo group models.** Superficially similar — a group with members
   and a code — but an Ajo group is a rotating payout scheme with slots,
   positions, swaps and a solvency invariant. A pool has no rotation and no
   payout entitlement. Sharing the model would force pool rows to carry a
   rotation schedule that must never run.

## Decision

Option 2. `AkawoPool`, `AkawoPoolMember`, and `AkawoPoolDue` are new models under
the Akawo boundary. `SavingsGoal` is untouched.

A pool collects money towards a stated purpose. It is **not** a rotation and
never disburses to members: an Ajo group pays each member in turn, whereas a pool
is spent by the organiser on the thing it was collected for, outside the app.
Modelling a payout here would be modelling a product nobody asked for.

Rules that hold at the data layer:

- A member's identity in a pool is the name and reference they supply on joining,
  not their platform profile. A course representative collecting from a class
  needs the matric number they can reconcile against, and the joiner may not have
  filled in a profile at all.
- A due is per member and per pool, in integer minor units and one currency.
  Amounts are strings across the API, as everywhere else.
- Paid state is derived from settled ledger movement, never set directly. A due
  is `PAID` because money arrived, and marking it paid without that is the one
  thing this model must make impossible.
- The join code is stored as a digest, like `GroupInvitation.tokenDigest`, so an
  outstanding code cannot be redeemed from a database dump.
- The organiser sees every member's name, reference, amount and payment time,
  because that is the product. Members see the pool, their own due, and the total
  collected — not other members' payment detail.

## Consequences

Collection is blocked until a payment workflow exists: no endpoint anywhere
currently moves money into a wallet, so a due can be created and read but not
settled. The schema is written so that settlement is a ledger posting plus a
status transition, with no other model change required.

PDF export is deliberately not a backend concern for MVP. The organiser view
returns the rows; rendering belongs to the client, and a server-side renderer is
a dependency to add only when a real requirement — scheduled emailing, say —
justifies it.

Nothing here pays or promises interest. ADR-003's boundary applies unchanged.
