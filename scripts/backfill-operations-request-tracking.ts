import '../env-init';

import { runOperationsBackfill } from '../lib/operations/backfill';

function readIntegerFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

async function main(): Promise<void> {
  const checkpoint = await runOperationsBackfill(undefined, {
    batchSize: readIntegerFlag('batch-size', 500),
    restart: process.argv.includes('--restart'),
  });

  console.log(JSON.stringify({
    phase: checkpoint.phase,
    counters: checkpoint.counters,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
