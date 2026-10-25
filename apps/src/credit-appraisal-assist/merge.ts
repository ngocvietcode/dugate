// Logic tất định của App: task nhánh 1, chuyển quyết định thành override, ghép kết quả, chạy lại một phần.
// (spec 002 FR-15..FR-17, FR-24, FR-25; lac-rules §9). Hàm thuần — chạy trong workflow.
import type { DecisionInput } from '../platform/workflow-kit';
import type { Lac } from '../generated/lac.zod';
import type { Conclusion, Outcome } from './schema';

type Disc = Lac['discrepancies'][number];
export type Resolution = 'RESOLVED' | 'SUPPLEMENT_REQUESTED';

export interface Overrides {
  facts: { entity: string; field: string; value: unknown; doc?: string; reason: string; by: string }[];
  discrepancies: { key: string; class: 'A' | 'B' | 'C'; reason: string; by: string }[];
  links: { doc: string; idx: number; party: string | null; reason: string; by: string }[];
}
export const emptyOverrides = (): Overrides => ({ facts: [], discrepancies: [], links: [] });

export interface TaskSpec { taskId: string; kind: 'DISCREPANCY' | 'PERSON_LINK'; ref: string; severity: string | null; title: string }

const needsPerson = (x: Disc) => x.class !== 'N' && x.status.startsWith('chờ xác nhận');

/** Task nhánh 1: sai lệch cần ảnh/người xác nhận (ưu tiên S1→S3) và liên kết người mức trung bình. */
export function reviewTasks(lac: Lac, runId: string, done: ReadonlySet<string> = new Set()): TaskSpec[] {
  const disc = lac.discrepancies.filter(needsPerson)
    .sort((a, b) => a.severity.localeCompare(b.severity))
    .map((x): TaskSpec => ({ taskId: `${runId}:X:${x.key}`, kind: 'DISCREPANCY', ref: x.key, severity: x.severity,
      title: `${x.id} ${x.class} ${x.subclass}: ${x.title}` }));
  const links = lac.mentions.filter((m) => m.confidence === 'trung bình')
    .map((m): TaskSpec => ({ taskId: `${runId}:L:${m.doc}:${m.idx}`, kind: 'PERSON_LINK', ref: `${m.doc}#${m.idx}`,
      severity: null, title: `Xác nhận ${m.doc} (${m.role ?? '?'}) là của ${m.party}: ${m.evidence.join(', ')}` }));
  return [...disc, ...links].filter((t) => !done.has(t.taskId));
}

const discByKey = (lac: Lac, key: string) => lac.discrepancies.find((x) => x.key === key);

/** Kiểm nghiệp vụ của quyết định (ngoài maker-checker). Trả lý do từ chối hoặc null. */
export function decisionViolation(d: DecisionInput, task: TaskSpec | undefined, lac: Lac): string | null {
  if (!task) return `task ${d.taskId} không tồn tại`;
  if (task.kind === 'PERSON_LINK') {
    return ['CONFIRM', 'REJECT_LINK'].includes(d.action) ? null : 'liên kết người chỉ nhận CONFIRM hoặc REJECT_LINK';
  }
  const x = discByKey(lac, task.ref);
  if (!x) return 'sai lệch không còn trong LAC hiện tại';
  switch (d.action) {
    case 'CONFIRM': return x.class === 'A|B' ? 'A|B phải được phân loại lại thành A hoặc B (RECLASSIFY)' : null;
    case 'RECLASSIFY': return d.newClass ? null : 'RECLASSIFY cần newClass';
    case 'CORRECT_VALUE': {
      if (d.value === undefined) return 'CORRECT_VALUE cần value';
      if (!['A', 'A|B', 'C'].includes(x.class)) return 'chỉ sửa giá trị cho lỗi đọc (A) hoặc nghi lỗi đọc';
      if (d.field) return lac.facts.some((f) => f.id === d.field) ? null : `${d.field} không tồn tại`;
      const fs = x.fields.filter((f) => f.startsWith('F'));
      return fs.length === 1 ? null : 'cần chỉ rõ field (F#) được sửa';
    }
    case 'REQUEST_SUPPLEMENT': return ['B', 'A|B'].includes(x.class) ? null : 'chỉ yêu cầu bổ sung cho lỗi lập hồ sơ (B)';
    default: return `hành động ${d.action} không áp dụng cho sai lệch`;
  }
}

/** Quyết định -> override cho LAC + trạng thái xử lý của sai lệch. */
export function applyDecision(o: Overrides, ledger: Record<string, Resolution>, d: DecisionInput, task: TaskSpec, lac: Lac): void {
  const by = d.actor.userId;
  if (task.kind === 'PERSON_LINK') {
    const [doc, idx] = task.ref.split('#');
    const m = lac.mentions.find((x) => x.doc === doc && x.idx === Number(idx))!;
    o.links = o.links.filter((l) => !(l.doc === doc && l.idx === Number(idx)));
    o.links.push({ doc, idx: Number(idx), party: d.action === 'CONFIRM' ? m.party : null, reason: d.reason, by });
    return;
  }
  const x = discByKey(lac, task.ref)!;
  const reclass = (cls: 'A' | 'B' | 'C') => {
    o.discrepancies = o.discrepancies.filter((y) => y.key !== x.key);
    if (cls !== x.class) o.discrepancies.push({ key: x.key, class: cls, reason: d.reason, by });
  };
  switch (d.action) {
    case 'CONFIRM': ledger[x.key] = 'RESOLVED'; break;
    case 'RECLASSIFY': reclass(d.newClass!); ledger[x.key] = d.newClass === 'B' ? 'SUPPLEMENT_REQUESTED' : 'RESOLVED'; break;
    case 'CORRECT_VALUE': {
      const fid = d.field ?? x.fields.find((f) => f.startsWith('F'))!;
      const f = lac.facts.find((y) => y.id === fid)!;
      o.facts = o.facts.filter((y) => !(y.entity === f.entity && y.field === f.field));
      o.facts.push({ entity: f.entity, field: f.field, value: d.value, reason: d.reason, by });
      reclass('A');
      ledger[x.key] = 'RESOLVED';
      break;
    }
    case 'REQUEST_SUPPLEMENT': ledger[x.key] = 'SUPPLEMENT_REQUESTED'; break;
  }
}

export interface Merged {
  outcome: Outcome;
  blocking: string[];
  conclusions: (Conclusion & { provisional: boolean; conditions: string[] })[];
}

/** Bước ghép (lac-rules §9): S1 chưa xử lý -> chờ bổ sung; K# trích thông tin vướng S2 -> tạm thời. */
export function merge(lac: Lac, ledger: Record<string, Resolution>, conclusions: Conclusion[]): Merged {
  const open = (x: Disc) => x.class !== 'N' && ledger[x.key] !== 'RESOLVED';
  const s1 = lac.discrepancies.filter((x) => x.severity === 'S1' && open(x));
  // phase1 là oneOf(null, object) trong schema -> Zod sinh kiểu lỏng; kiểu hẹp ở đây
  const phase1 = lac.case.phase1 as { items?: { key: string; required: boolean; status: string; reasons: string[] }[] } | null;
  const p1 = (phase1?.items ?? []).filter((i) => i.required && i.status === 'MISSING');
  const blocking = [...s1.map((x) => `${x.id}: ${x.title}`), ...p1.map((i) => `checklist ${i.key}: ${i.reasons.join('; ') || 'thiếu'}`)];
  const s2 = lac.discrepancies.filter((x) => x.severity === 'S2' && open(x));
  const s2ById = new Map(s2.map((x) => [x.id, x]));
  const factFlags = new Map(lac.facts.map((f) => [f.id, f.flags.map((fl) => fl.split(':')[0])]));
  const out = conclusions.map((k) => {
    const hit = new Set<string>();
    for (const x of k.conflicts) if (s2ById.has(x)) hit.add(x);
    for (const f of k.fields) for (const x of factFlags.get(f) ?? []) if (s2ById.has(x)) hit.add(x);
    const conditions = [...hit].sort().map((x) => `${x}: ${s2ById.get(x)!.title}`);
    return { ...k, provisional: conditions.length > 0, conditions };
  });
  const outcome: Outcome = blocking.length ? 'PENDING_SUPPLEMENT' : out.some((k) => k.provisional) ? 'PROVISIONAL' : 'ELIGIBLE_TO_SUBMIT';
  return { outcome, blocking, conclusions: out };
}

/** Sau khi dựng lại LAC: đổi mã X#/T# trong kết luận sang mã mới, và tìm K# cần chạy lại (FR-25). */
export function reconcile(prev: Lac, next: Lac, conclusions: Conclusion[]): {
  conclusions: Conclusion[]; affected: string[]; newConflicts: string[];
} {
  const prevX = new Map(prev.discrepancies.map((x) => [x.id, x]));
  const nextXByKey = new Map(next.discrepancies.map((x) => [x.key, x]));
  const tKey = (t: Lac['signals'][number]) => `${t.rule}|${t.title}`;
  const prevT = new Map(prev.signals.map((t) => [t.id, tKey(t)]));
  const nextTByKey = new Map(next.signals.map((t) => [tKey(t), t.id]));
  const prevF = new Map(prev.facts.map((f) => [f.id, JSON.stringify(f.value)]));
  const changedF = new Set(next.facts.filter((f) => prevF.get(f.id) !== JSON.stringify(f.value)).map((f) => f.id));
  const affected = new Set<string>();
  const remapped = conclusions.map((k) => {
    let hit = k.fields.some((f) => changedF.has(f));
    const conflicts: string[] = [];
    for (const x of k.conflicts) {
      const nx = prevX.get(x) && nextXByKey.get(prevX.get(x)!.key);
      if (nx && nx.class === 'C') conflicts.push(nx.id); else hit = true;
    }
    const signals: string[] = [];
    for (const t of k.signals) {
      const nt = prevT.get(t) && nextTByKey.get(prevT.get(t)!);
      if (nt) signals.push(nt); else hit = true;
    }
    if (hit) affected.add(k.id);
    return { ...k, conflicts, signals };
  });
  const prevC = new Set(prev.discrepancies.filter((x) => x.class === 'C').map((x) => x.key));
  const newConflicts = next.discrepancies.filter((x) => x.class === 'C' && !prevC.has(x.key)).map((x) => x.id);
  return { conclusions: remapped, affected: [...affected].sort(), newConflicts };
}
