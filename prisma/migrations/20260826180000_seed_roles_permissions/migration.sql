-- Provision the role/permission catalogue.
--
-- Until now the only thing that created these rows was prisma/seed/seed-runner.ts,
-- which refuses to run when NODE_ENV=production. A production database therefore
-- had the tables but none of the grants, so PermissionsGuard denied every
-- permissioned route — including staff invites — to every operator, whatever
-- role they held. Roles and grants are reference data the application depends on
-- to function, so they belong in a migration.
--
-- Written to be re-runnable: ON CONFLICT DO NOTHING throughout, so this neither
-- duplicates rows on an already-seeded database nor overwrites grants an
-- operator has since customised.

INSERT INTO "permissions" ("id", "key")
SELECT gen_random_uuid(), key
FROM (VALUES
  ('users.read'),
  ('users.suspend'),
  ('kyc.review'),
  ('food-coordinators.review'),
  ('bill-payments.reconcile'),
  ('ajo.create'),
  ('ajo.manage'),
  ('ajo.lock'),
  ('ajo.swap.initiate'),
  ('ajo.swap.approve'),
  ('payouts.review'),
  ('payouts.execute'),
  ('withdrawals.review'),
  ('fees.manage'),
  ('disputes.manage'),
  ('audit.read'),
  ('staff.manage'),
  ('profile.read'),
  ('profile.update')
) AS seed(key)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "roles" ("id", "name", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid(), name, true, NOW(), NOW()
FROM (VALUES
  ('SUPER_ADMIN'),
  ('PLATFORM_ADMIN'),
  ('COMPLIANCE_OFFICER'),
  ('FINANCE_OFFICER'),
  ('SUPPORT_OFFICER'),
  ('GROUP_ADMIN'),
  ('FOOD_COORDINATOR'),
  ('MEMBER')
) AS seed(name)
ON CONFLICT ("name") DO NOTHING;

-- The two administrator roles hold everything, including permissions added by
-- later migrations, so they are granted by cross join rather than a fixed list.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('SUPER_ADMIN', 'PLATFORM_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN (VALUES
  ('COMPLIANCE_OFFICER', 'users.read'),
  ('COMPLIANCE_OFFICER', 'kyc.review'),
  ('COMPLIANCE_OFFICER', 'food-coordinators.review'),
  ('COMPLIANCE_OFFICER', 'audit.read'),
  ('FINANCE_OFFICER', 'users.read'),
  ('FINANCE_OFFICER', 'payouts.review'),
  ('FINANCE_OFFICER', 'payouts.execute'),
  ('FINANCE_OFFICER', 'withdrawals.review'),
  ('FINANCE_OFFICER', 'audit.read'),
  ('SUPPORT_OFFICER', 'users.read'),
  ('SUPPORT_OFFICER', 'disputes.manage'),
  ('GROUP_ADMIN', 'ajo.create'),
  ('GROUP_ADMIN', 'ajo.manage'),
  ('GROUP_ADMIN', 'ajo.lock'),
  ('GROUP_ADMIN', 'ajo.swap.initiate'),
  ('GROUP_ADMIN', 'ajo.swap.approve'),
  ('FOOD_COORDINATOR', 'ajo.create'),
  ('MEMBER', 'ajo.create'),
  ('MEMBER', 'ajo.lock'),
  ('MEMBER', 'ajo.swap.initiate')
) AS role_grant("role", "permission") ON role_grant."role" = r.name
JOIN "permissions" p ON p.key = role_grant."permission"
ON CONFLICT DO NOTHING;

-- Every staff role can read and update its own profile.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p.key IN ('profile.read', 'profile.update')
ON CONFLICT DO NOTHING;
