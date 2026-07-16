import 'dotenv/config';
import { runSeed } from './seed-runner.js';

runSeed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown seed failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
