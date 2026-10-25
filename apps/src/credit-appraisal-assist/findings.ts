// LAC -> Finding theo Workflow Service Contract (LAYERED_ARCHITECTURE §5.2). Hàm thuần.
import type { Finding } from '../platform/contract';
import type { Lac } from '../generated/lac.zod';

export function findingsFromLac(lac: Lac): Finding[] {
  const cfg = `${lac.case.config.product}@${lac.case.config.version}`;
  const facts = new Map(lac.facts.map((f) => [f.id, f]));
  const docsOf = (ids: string[]) => [...new Set(ids.flatMap((id) => facts.get(id)?.sources ?? []))]
    .filter((d) => /^D\d+$/.test(d)).sort().map((documentId) => ({ documentId }));
  const out: Finding[] = [];
  for (const x of lac.discrepancies) {
    if (x.class === 'N') continue;
    const fs = x.fields.filter((f) => /^F\d+$/.test(f));
    const direct = x.fields.map((f) => f.match(/^(D\d+)\./)?.[1] ?? f.match(/^CIC@(D\d+)/)?.[1]).filter(Boolean) as string[];
    const evidence = [...docsOf(fs), ...direct.map((documentId) => ({ documentId }))];
    out.push({ code: x.rule, kind: 'DISCREPANCY', severity: x.severity, message: `${x.id} [${x.class} ${x.subclass}] ${x.title}`,
      evidence, refs: { facts: fs, discrepancies: [x.id], signals: [] }, rule: { id: x.rule, configRef: cfg } });
  }
  for (const t of lac.signals) {
    out.push({ code: t.rule, kind: 'SIGNAL', severity: null, message: `${t.id} ${t.title} — ${t.detail}`, evidence: docsOf(t.fields),
      refs: { facts: t.fields, discrepancies: t.discrepancies, signals: [t.id] }, rule: { id: t.rule, configRef: cfg } });
  }
  const p1 = lac.case.phase1 as { items?: { key: string; status: string; required: boolean; docs: string[]; reasons: string[] }[] } | null;
  for (const i of p1?.items ?? []) {
    if (i.status === 'PASS') continue;
    out.push({ code: `CHECKLIST-${i.status}`, kind: 'CHECKLIST', severity: i.status === 'MISSING' && i.required ? 'S1' : 'S3',
      message: `${i.key}: ${i.reasons.join('; ')}`, evidence: i.docs.map((documentId) => ({ documentId })),
      refs: { facts: [], discrepancies: [], signals: [] }, rule: { id: 'PHASE1', configRef: cfg } });
  }
  return out;
}
