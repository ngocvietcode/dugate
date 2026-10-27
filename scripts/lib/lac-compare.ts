type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
// Identifiers/codes only; never project free-text fields into either output.
const id = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v) ? v : 'INVALID_ID';
export interface Pair { label: string; off: string; on: string }
export function parsePairs(value: unknown): Pair[] {
  if (!Array.isArray(value)) throw new Error('pairs must be an array');
  return value.map(v => {
    const p = obj(v);
    if (['label', 'off', 'on'].some(k => id(p[k]) === 'INVALID_ID')) throw new Error('Each pair needs identifier-only label, off and on');
    return { label: p.label as string, off: p.off as string, on: p.on as string };
  });
}
function side(raw: unknown) {
  const op = obj(raw), metadata = obj(op.metadata), result = obj(op.result), data = obj(result.extracted_data);
  const rules = new Map<string, { outcome: string; reason: string; evidence: number; confidence: number | null }>();
  if (metadata.state !== 'SUCCEEDED') return { state: id(metadata.state), rules, metrics: {} as Record<string, number | boolean | null>, valid: false };
  if (!Array.isArray(obj(data.policy_compliance).rule_results)) throw new Error('SUCCEEDED operation has no policy rule_results');
  for (const item of arr(obj(data.policy_compliance).rule_results)) {
    const r = obj(item);
    if (r.check_kind !== 'PROMPT') continue;
    const key = id(r.rule_id);
    if (key === 'INVALID_ID' || rules.has(key)) throw new Error('Invalid or duplicate PROMPT rule_id');
    rules.set(key, { outcome: id(r.result), reason: r.reason_code == null ? 'MISSING' : id(r.reason_code), evidence: arr(r.evidence_ids).length, confidence: num(r.confidence) });
  }
  const step = arr(metadata.pipeline_steps).map(obj).find(s => s.stage_key === 'evaluate_policy_compliance');
  const preview = obj(step?.content_preview), lac = obj(preview.lac), summary = obj(data.loan_application_context_summary), usage = obj(result.usage);
  const input = num(usage.input_tokens), output = num(usage.output_tokens);
  const metrics: Record<string, number | boolean | null> = {
    prompt_evidence_chars: num(obj(preview.prompt_evidence).chars), lac_chars: num(lac.chars), facts_rendered: num(lac.facts_rendered), truncated: typeof lac.truncated === 'boolean' ? lac.truncated : null,
    fact_count: num(summary.fact_count), conflicts: num(summary.conflicts), gaps: Array.isArray(summary.gaps) ? summary.gaps.reduce<number>((n, g) => n + (num(obj(g).count) ?? 0), 0) : num(summary.gaps),
    tokens: num(usage.total_tokens) ?? (input !== null && output !== null ? input + output : null), cost_usd: num(usage.cost_usd),
  };
  return { state: 'SUCCEEDED', rules, metrics, valid: true };
}
export function comparePair(pair: Pair, offRaw: unknown, onRaw: unknown) {
  const off = side(offRaw), on = side(onRaw);
  const skipped = !off.valid || !on.valid;
  const rows = skipped ? [] : [...new Set([...off.rules.keys(), ...on.rules.keys()])].sort().map(rule_id => {
    const a = off.rules.get(rule_id) ?? null, b = on.rules.get(rule_id) ?? null;
    return { rule_id, off: a, on: b, changed: a !== null && b !== null && a.outcome !== b.outcome };
  });
  return { pair, skipped, off, on, rows };
}
export type Comparison = ReturnType<typeof comparePair>;
const show = (v: unknown): string => v == null ? 'N/A' : String(v);
export function renderReports(pairs: Comparison[], localOptIn = false) {
  const compared = pairs.filter(p => !p.skipped), rows = compared.flatMap(p => p.rows), matched = rows.filter(r => r.off && r.on), changed = rows.filter(r => r.changed);
  const mean = (sideName: 'off' | 'on', metric: string) => {
    const values = compared.map(p => p[sideName].metrics[metric]).filter((v): v is number => typeof v === 'number');
    return values.length ? `${values.reduce((a,b) => a+b,0) / values.length} (n=${values.length})` : 'N/A (n=0)';
  };
  const count = (sideName: 'off' | 'on', code: string) => rows.filter(r => r[sideName]?.reason === code).length;
  const pr = changed.filter(r => r.off?.outcome === 'PASS' && r.on?.outcome === 'REVIEW').length;
  const rp = changed.filter(r => r.off?.outcome === 'REVIEW' && r.on?.outcome === 'PASS').length;
  const summary = [
    `Pairs compared: ${compared.length}; skipped: ${pairs.length-compared.length}`,
    `Rules compared: ${matched.length}; unmatched: ${rows.length-matched.length}; outcome changed: ${changed.length}`,
    `PASS -> REVIEW: ${pr}; REVIEW -> PASS: ${rp}; other: ${changed.length-pr-rp}`,
    ...['PROMPT_CHECK_EVIDENCE_MISSING', 'PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED'].map(c => `${c} off/on: ${count('off',c)} / ${count('on',c)}`),
    `Average prompt chars off/on: ${mean('off','prompt_evidence_chars')} / ${mean('on','lac_chars')}`,
    `Average tokens off/on: ${mean('off','tokens')} / ${mean('on','tokens')}`,
  ].join('\n');
  const md = ['# LAC shadow report', '', '```text', summary, '```', '', 'Prompt chars measure evidence/context blocks, not the entire model prompt. Missing measurements are excluded from averages. Unmatched rules are not outcome changes.', '', `Requests use ssrfSafeFetch with a 30000 ms timeout; redirects are not followed. Localhost opt-in: ${localOptIn}. --allow-localhost adds only the configured localhost/127.0.0.1 host to this process allowlist.`, ''];
  const csv: unknown[][] = [['pair','off_operation','on_operation','rule_id','off','on','changed','reason_off','reason_on','evidence_off','evidence_on','confidence_off','confidence_on']];
  for (const p of pairs) {
    md.push(`## ${p.pair.label}`, `Operations: ${p.pair.off} / ${p.pair.on}`, '');
    if (p.skipped) { md.push(`Skipped: off=${p.off.state}; on=${p.on.state}`, ''); continue; }
    md.push('| metric | off | on |','| --- | --- | --- |');
    for (const k of Object.keys(p.off.metrics)) md.push(`| ${k} | ${show(p.off.metrics[k])} | ${show(p.on.metrics[k])} |`);
    md.push('', '| rule_id | off | on | changed? | reason off | reason on | evidence off/on | confidence off/on |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of p.rows) {
      md.push(`| ${r.rule_id} | ${show(r.off?.outcome)} | ${show(r.on?.outcome)} | ${!r.off || !r.on ? 'UNMATCHED' : r.changed} | ${show(r.off?.reason)} | ${show(r.on?.reason)} | ${show(r.off?.evidence)} / ${show(r.on?.evidence)} | ${show(r.off?.confidence)} / ${show(r.on?.confidence)} |`);
      csv.push([p.pair.label,p.pair.off,p.pair.on,r.rule_id,r.off?.outcome,r.on?.outcome,!r.off || !r.on ? 'UNMATCHED' : r.changed,r.off?.reason,r.on?.reason,r.off?.evidence,r.on?.evidence,r.off?.confidence,r.on?.confidence]);
    }
    md.push('');
  }
  md.push('## Cần CO chấm', '', '| pair | rule_id | off | on | CO: off đúng / on đúng / cả hai |','| --- | --- | --- | --- | --- |');
  for (const p of compared) for (const r of p.rows.filter(r => r.changed)) md.push(`| ${p.pair.label} | ${r.rule_id} | ${r.off?.outcome} | ${r.on?.outcome} | |`);
  return { summary, markdown: md.join('\n')+'\n', csv: csv.map(row => row.map(v => `"${show(v).replace(/"/g,'""')}"`).join(',')).join('\r\n')+'\r\n' };
}
