import { DETERMINISTIC_CHECK_IDS, LOAN_CHECK_CATALOG, type LoanCheckDefinition } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { isRuleGroupKey, resolveRuleGroup } from '@/lib/pipelines/workflows/loan-appraisal/rule-groups';
export type Editable = LoanCheckDefinition & { isCustom: boolean };
const SEVERITIES = ['BLOCKER', 'EXCEPTION', 'REVIEW', 'INFO'] as const;

export const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Hợp nhất cấu hình đã lưu với catalog: luôn liệt kê đủ rule của catalog để admin thấy cả rule bị tắt. */
export function readChecks(saved: Record<string, unknown> | undefined): Editable[] {
  const catalog = new Map(LOAN_CHECK_CATALOG.map((c) => [c.id, c]));
  const list = Array.isArray(saved?.checks) ? saved!.checks : [];
  const seen = new Set<string>();
  const out: Editable[] = [];
  for (const raw of list) {
    const item = asRecord(raw);
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!item || !id || seen.has(id)) continue;
    seen.add(id);
    const base = catalog.get(id);
    const engine = (DETERMINISTIC_CHECK_IDS as readonly string[]).includes(id);
    out.push({
      ...(base ?? { id, name: id, kind: 'PROMPT', enabled: true, flows: [], products: [], input: [], action: 'warn', severity: 'REVIEW', exception_allowed: false, version: '1.0.0', prompt: '', threshold: 0.85 }),
      ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}),
      kind: engine ? 'DETERMINISTIC' : 'PROMPT',
      group: isRuleGroupKey(item.group) ? item.group : resolveRuleGroup({ id, group: base?.group }),
      enabled: item.enabled !== false,
      action: item.action === 'block' ? 'block' : 'warn',
      severity: SEVERITIES.includes(String(item.severity).toUpperCase() as typeof SEVERITIES[number]) ? String(item.severity).toUpperCase() as Editable['severity'] : base?.severity ?? 'REVIEW',
      exception_allowed: item.exception_allowed === true,
      ...(engine ? { params: Object.fromEntries(Object.entries(asRecord(item.params) ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number')) } : {
        prompt: typeof item.prompt === 'string' ? item.prompt : base?.prompt ?? '',
        allow_declared_pass: item.allow_declared_pass === true,
        threshold: typeof item.threshold === 'number' ? item.threshold : base?.threshold ?? 0.85,
      }),
      isCustom: !base,
    });
  }
  for (const base of LOAN_CHECK_CATALOG) if (!seen.has(base.id)) out.push({ ...base, group: resolveRuleGroup(base), isCustom: false });
  return out;
}

/** Bản lưu: bỏ `flows` / `products` (phạm vi do công tắc theo luồng quyết định). */
export function serialize(checks: Editable[]) {
  return checks.map((c) => ({
    id: c.id, name: c.name, kind: c.kind, group: resolveRuleGroup(c), enabled: c.enabled, input: c.input, action: c.action, severity: c.severity,
    exception_allowed: c.exception_allowed, version: c.version,
    ...(c.kind === 'DETERMINISTIC' && c.params && Object.keys(c.params).length ? { params: c.params } : {}),
    ...(c.kind === 'PROMPT' && c.allow_declared_pass ? { allow_declared_pass: true } : {}),
    ...(c.kind === 'PROMPT' ? { prompt: c.prompt ?? '', threshold: c.threshold ?? 0.85 } : {}),
  }));
}
