#!/usr/bin/env node
/**
 * Applies committed migrations, then exits. Used by the `migrate` service in
 * docker-compose.yaml as a release step (see docs/deployment.md).
 *
 * It wraps `prisma migrate deploy` for two reasons.
 *
 * First, diagnosis. Compose reports only `service "migrate" didn't complete
 * successfully: exit 1`, so the reason never reaches the deployment log. The
 * two common causes look identical from the outside and need opposite fixes:
 * an unreachable database (P1001) versus a missing DATABASE_URL. This prints
 * which one it was, with the host but never the credentials.
 *
 * Second, ordering. Postgres is a separate Coolify resource rather than a
 * service in this file, so compose cannot gate on its health and the migration
 * can start before it accepts connections. Connection failures are retried;
 * a rejected migration is not, because retrying bad SQL cannot help.
 */
import { spawnSync } from 'node:child_process';

const ATTEMPTS = 10;
const DELAY_MS = 3000;
/** Prisma's code for "cannot reach the database server". */
const UNREACHABLE = 'P1001';

/** Strips credentials so a failure can name the target without leaking it. */
function safeTarget(raw) {
  if (!raw) return '<unset>';
  try {
    const url = new URL(raw);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    // Not parseable as a URL: say so rather than echoing a possible secret.
    return '<unparseable DATABASE_URL>';
  }
}

const target = safeTarget(process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set for the migrate service. Compose passes it through ' +
      'from the deployment environment; set it there before redeploying.',
  );
  process.exit(1);
}

console.log(`Applying migrations to ${target}`);

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { encoding: 'utf8' },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  if (result.status === 0) {
    console.log('Migrations applied.');
    process.exit(0);
  }

  // Only a connection failure is worth retrying. A migration the database
  // rejected will be rejected identically every time, and repeating it only
  // delays the deployment failure.
  if (!output.includes(UNREACHABLE)) {
    console.error(`Migration failed against ${target}. See the Prisma error above.`);
    process.exit(result.status ?? 1);
  }

  if (attempt === ATTEMPTS) {
    console.error(
      `Database at ${target} was unreachable after ${ATTEMPTS} attempts. ` +
        'Check that the database resource is running and that this service is on its network.',
    );
    process.exit(1);
  }

  console.warn(`Database unreachable (attempt ${attempt}/${ATTEMPTS}); retrying in ${DELAY_MS}ms.`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, DELAY_MS);
}
