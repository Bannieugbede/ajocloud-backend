# Akawo savings

Akawo is the canonical name for flexible, target, and locked personal/goal savings. Flexible and
target goal creation, owner-scoped list/detail, succeeded-contribution progress, and cursor-paginated
statements are implemented. Money remains integer minor units and API amounts are strings.

API:

- `POST /api/v1/akawo/goals` — create an active `FLEXIBLE` or `TARGET` goal. Target goals require a
  positive target; future target dates are optional.
- `GET /api/v1/akawo/goals` — owner-scoped goals with `savedMinor` and `progressBps`.
- `GET /api/v1/akawo/goals/:goalId` — owner-scoped detail/progress.
- `GET /api/v1/akawo/goals/:goalId/statement?cursor=&limit=` — owner-scoped contribution statement.
- `POST /api/v1/akawo/goals/:goalId/schedules` — create a future schedule for an active owned goal;
  this records intent and does not claim that money moved.

Locked creation fails closed until its early-withdrawal policy is approved. Manual deposits,
auto-save execution, and withdrawals remain separate roadmap work; these read/create APIs never fake
ledger success.

MVP Akawo pays no interest and must not display or promise a return. ADR-003 requires a regulated institutional partner and separate legal/compliance approval before future products can add enrolment, opt-in/opt-out, non-interest preferences, yield accrual/distribution, settlement, withholding, statements, or reconciliation.

## Akawo group pools

A pool is a **collection**, not a rotation: an organiser gathers a fixed amount
from named members towards a stated purpose, and spends it outside the app.
Nothing disburses to members. Pools are a separate aggregate from personal
`SavingsGoal` records — see [ADR-007](adr/ADR-007-akawo-group-pools.md) for why
they are not the same model.

A member's identity within a pool is the name and reference they supply on
joining (`referenceLabel` defaults to "Reference"; a class would set "Matric
number"), not their platform profile, because the organiser reconciles against
what they already hold and the joiner may have no profile at all.

The join code is shown once, on creation, and only its SHA-256 digest is stored.
Its alphabet excludes `O`, `I`, `L`, `0` and `1`, because these codes are read
aloud and typed by hand.

API — all routes require authentication:

- `POST /api/v1/akawo/pools` — create a `DRAFT` pool. The response is the only
  time the plaintext `joinCode` exists.
- `GET /api/v1/akawo/pools/organised` — pools this user organises, with totals.
- `GET /api/v1/akawo/pools/joined` — pools this user has joined, each with their
  own due.
- `GET /api/v1/akawo/pools/preview?joinCode=` — name, amount and organiser for a
  code, so a joiner can confirm before committing. An unknown code and an
  unavailable pool report identically, so a guessed code reveals nothing.
- `POST /api/v1/akawo/pools/join` — join with a code, full name and reference.
  Membership and the due are created in one transaction, so a membership never
  exists without its obligation.
- `GET /api/v1/akawo/pools/:poolId` — the member's own view: the pool, their due,
  and pool totals. Deliberately excludes other members' payment detail.
- `GET /api/v1/akawo/pools/:poolId/organiser` — every member, reference and
  payment state. This is the record the client renders as a PDF; server-side
  rendering is not an MVP concern.
- `PATCH /api/v1/akawo/pools/:poolId` — edit name, purpose or due date while open.
- `POST /api/v1/akawo/pools/:poolId/open|close|cancel` — lifecycle. `DRAFT → OPEN
→ CLOSED`; `CLOSED` and `CANCELLED` are terminal. Cancelling is refused once
  any payment has arrived, because there is no refund workflow and cancelling
  would strand the money.
- `POST /api/v1/akawo/pools/:poolId/members/:memberId/remove` — refused once the
  member has paid.
- `POST /api/v1/akawo/pools/:poolId/members/:memberId/waive` — records that a
  member is not expected to pay. `WAIVED` is deliberately distinct from `PAID`:
  nothing was collected.

**A due reaches `PAID` only when a settled ledger transaction posts against it.**
No route in this module writes that status, and a test asserts the service source
contains no such write. Collection is therefore blocked until the payment
workflow exists; the schema needs no further change to support it.
