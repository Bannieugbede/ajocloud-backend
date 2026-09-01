# Seeders

One seeder per feature area. `seed-runner.ts` owns permissions, roles, the
role-holding accounts, and the base fixtures every other seeder builds on.

| Seeder                   | Covers                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| `admin-demo.ts`          | Demo users and the data behind every admin console listing               |
| `dashboard-activity.ts`  | Ledger volume and fee history for the dashboard charts                   |
| `ajo-governance.ts`      | Schedule versions, invitations, referral codes, swap requests, approvals |
| `identity-compliance.ts` | Consents, bank account, transaction PIN, compliance reviews, audit log   |
| `notifications.ts`       | Notification history, delivery attempts, channel preferences             |
| `referrals.ts`           | Referral campaign, referrals, qualifications, rewards                    |

The last four run after the first two because each reads the users, groups, and
profiles those create. Each returns early when its prerequisites are missing, so
running against an empty database is a no-op rather than a crash.

## Rules

Every write is an upsert or a guarded create: the seed must be safe to re-run.
Use fixed UUIDs for rows other seeders or tests reference.

Never seed real identity or financial data. Where the application stores a
masked value plus a digest — bank accounts, invitation codes, PINs — seed it the
same way, computed with the same helper, so the fixture both works and holds
nothing recoverable.

Do not seed a table the application does not read (`NotificationTemplate`,
whose templates live in code), one the application derives for itself
(`AdminNotification`, built by the console's sync endpoint), or one whose
workflow does not exist yet (payouts, withdrawals, contributions, disputes).
A row no code can produce or transition out of is misleading, not useful.
