/**
 * Operator submits the same dossier twice to POST /api/v1/docs/workflows (process=loan-appraisal), once with
 * form field lac_mode=off (or omitted) and once with lac_mode=on — or picks the mode on /loan-appraisal-v2.
 * If the Profile locks lac_mode, the request is rejected; unlock it for the UAT Profile first.
 * Set DUGATE_BASE_URL and DUGATE_API_KEY in the environment (never in pairs.json).
 * npx tsx scripts/lac-shadow-report.ts --pairs pairs.json --out report.md [--csv report.csv]
 * pairs.json: [{"label":"HS-01","off":"operation-off","on":"operation-on"}]
 * Local development: add --allow-localhost to opt into localhost/127.0.0.1 only.
 * Uses the existing ALLOWED_PRIVATE_HOSTS mechanism in this CLI process only;
 * no shared SSRF policy is modified. Redirects are rejected, never followed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ssrfSafeFetch } from '../lib/pipelines/processors/http-client';
import { comparePair, parsePairs, renderReports, type Comparison } from './lib/lac-compare';
async function main(): Promise<void> {
  const base = process.env.DUGATE_BASE_URL, apiKey = process.env.DUGATE_API_KEY;
  const missing = ['DUGATE_BASE_URL', 'DUGATE_API_KEY'].filter(k => !process.env[k]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  let url: URL;
  try { url = new URL(base!); } catch { throw new Error('DUGATE_BASE_URL must be a valid HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('DUGATE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  const options = new Map<string,string>();
  let local = false;
  const args = process.argv.slice(2);
  for (let i=0;i<args.length;i++) {
    const key = args[i];
    if (key === '--allow-localhost') { local = true; continue; }
    if (!['--pairs','--out','--csv'].includes(key) || options.has(key) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Usage: --pairs pairs.json --out report.md [--csv report.csv] [--allow-localhost]');
    options.set(key,args[++i]);
  }
  if (!options.has('--pairs') || !options.has('--out')) throw new Error('--pairs and --out are required');
  const paths = [...options.values()].map(p => resolve(p));
  if (new Set(paths).size !== paths.length) throw new Error('Input and output paths must be distinct');
  if (local) {
    if (!['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('--allow-localhost requires localhost or 127.0.0.1');
    process.env.ALLOWED_PRIVATE_HOSTS = [process.env.ALLOWED_PRIVATE_HOSTS,url.hostname].filter(Boolean).join(',');
  }
  let input: unknown;
  try { input = JSON.parse(await readFile(options.get('--pairs')!, 'utf8')); } catch { throw new Error('Cannot read or parse pairs JSON'); }
  const pairs = parsePairs(input), comparisons: Comparison[] = [];
  async function load(operation: string): Promise<unknown> {
    try {
      const response = await ssrfSafeFetch(`${url.origin}/api/v1/operations/${encodeURIComponent(operation)}`, { method: 'GET', headers: { 'x-api-key': apiKey! }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      return await response.json();
    } catch { throw new Error('Operation request failed (HTTP, network, SSRF, timeout or JSON). Check configuration and operation access.'); }
  }
  for (const pair of pairs) comparisons.push(comparePair(pair, await load(pair.off), await load(pair.on)));
  const report = renderReports(comparisons, local);
  try {
    await writeFile(options.get('--out')!, report.markdown, 'utf8');
    if (options.has('--csv')) await writeFile(options.get('--csv')!, report.csv, 'utf8');
  } catch { throw new Error('Cannot write report output'); }
  console.log('LAC report written.');
}
main().catch((error: unknown) => {
  // Only our fixed diagnostics are emitted; never print transport errors or payloads.
  console.error(error instanceof Error ? error.message : 'LAC report failed');
  process.exitCode = 1;
});
