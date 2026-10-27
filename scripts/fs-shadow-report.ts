/**
 * T-FS-04 (D-109). Operator runs dossiers with form field s3_matcher=shadow (POST /api/v1/docs/workflows, process=loan-appraisal),
 * then aggregates the Fellegi-Sunter vs rules comparison. Output holds counts and ids only.
 * Set DUGATE_BASE_URL and DUGATE_API_KEY in the environment (never in operations.json).
 * npx tsx scripts/fs-shadow-report.ts --operations operations.json --out report.md [--csv report.csv] [--allow-localhost]
 * operations.json: ["operation-id-1", "operation-id-2"]
 * --allow-localhost opts into localhost/127.0.0.1 only, through ALLOWED_PRIVATE_HOSTS of this CLI process. Redirects are rejected.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ssrfSafeFetch } from '../lib/pipelines/processors/http-client';
import { parseOperations, readOperation, renderFsReport, type FsRow } from './lib/fs-shadow';

async function main(): Promise<void> {
  const base = process.env.DUGATE_BASE_URL, apiKey = process.env.DUGATE_API_KEY;
  const missing = ['DUGATE_BASE_URL', 'DUGATE_API_KEY'].filter((k) => !process.env[k]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  let url: URL;
  try { url = new URL(base!); } catch { throw new Error('DUGATE_BASE_URL must be a valid HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('DUGATE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  const options = new Map<string, string>();
  let local = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--allow-localhost') { local = true; continue; }
    if (!['--operations', '--out', '--csv'].includes(key) || options.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --operations operations.json --out report.md [--csv report.csv] [--allow-localhost]');
    options.set(key, args[++i]);
  }
  if (!options.has('--operations') || !options.has('--out')) throw new Error('--operations and --out are required');
  const paths = [...options.values()].map((p) => resolve(p));
  if (new Set(paths).size !== paths.length) throw new Error('Input and output paths must be distinct');
  if (local) {
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('--allow-localhost requires localhost or 127.0.0.1');
    process.env.ALLOWED_PRIVATE_HOSTS = [process.env.ALLOWED_PRIVATE_HOSTS, url.hostname].filter(Boolean).join(',');
  }
  let input: unknown;
  try { input = JSON.parse(await readFile(options.get('--operations')!, 'utf8')); } catch { throw new Error('Cannot read or parse operations JSON'); }
  const rows: FsRow[] = [];
  for (const operation of parseOperations(input)) {
    let raw: unknown;
    try {
      const response = await ssrfSafeFetch(`${url.origin}/api/v1/operations/${encodeURIComponent(operation)}`, { method: 'GET', headers: { 'x-api-key': apiKey! }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      raw = await response.json();
    } catch { throw new Error('Operation request failed (HTTP, network, SSRF, timeout or JSON). Check configuration and operation access.'); }
    rows.push(readOperation(operation, raw));
  }
  const report = renderFsReport(rows);
  try {
    await writeFile(options.get('--out')!, report.markdown, 'utf8');
    if (options.has('--csv')) await writeFile(options.get('--csv')!, report.csv, 'utf8');
  } catch { throw new Error('Cannot write report output'); }
  console.log('Fellegi-Sunter shadow report written.');
}

main().catch((error: unknown) => {
  // Only our fixed diagnostics are emitted; never print transport errors or payloads.
  console.error(error instanceof Error ? error.message : 'Fellegi-Sunter shadow report failed');
  process.exitCode = 1;
});
