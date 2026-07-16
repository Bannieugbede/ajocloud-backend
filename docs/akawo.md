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

Locked creation fails closed until its early-withdrawal policy is approved. Manual deposits,
auto-save execution, and withdrawals remain separate roadmap work; these read/create APIs never fake
ledger success.

MVP Akawo pays no interest and must not display or promise a return. ADR-003 requires a regulated institutional partner and separate legal/compliance approval before future products can add enrolment, opt-in/opt-out, non-interest preferences, yield accrual/distribution, settlement, withholding, statements, or reconciliation.
