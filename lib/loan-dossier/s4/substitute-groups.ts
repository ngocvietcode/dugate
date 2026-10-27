// Mục có chứng từ thay thế không còn bắt buộc riêng (S4-R27, D-48).
//   (1) Mục bắt buộc đã được thay thế (`SUBSTITUTED`) → `required = false`: yêu cầu đã đạt nhờ chứng từ khác.
//   (2) Nhiều mục bắt buộc cùng phạm vi thay thế được cho nhau mà đều chưa đạt → chỉ giữ 1 mục bắt buộc (ghi các lựa chọn
//       khác), các mục còn lại `NOT_APPLICABLE`/`COVERED_BY_ALTERNATIVE`. Nhóm thay thế chỉ là 1 yêu cầu, không đếm N lần.
// Không áp cho mục đang tắt thay thế (VD GCN ĐKHKD khi khoản vay > 3 tỷ — `requires_exact_doc_when_met`).
import type { ChecklistItemResult } from '../contracts/check-stages';
import { loadChecklistCatalog } from './catalog';

const UNMET = ['MISSING', 'NEEDS_RESCAN', 'NEEDS_REVIEW'];
const PRIORITY: Record<string, number> = { NEEDS_RESCAN: 0, NEEDS_REVIEW: 1, MISSING: 2 };

const scopeKey = (it: ChecklistItemResult) => `${it.scope}|${it.person_id ?? ''}|${it.asset_id ?? ''}`;

export function applySubstituteGroups(items: ChecklistItemResult[], allowSubstitute: ReadonlyArray<boolean>): ChecklistItemResult[] {
  const catalog = loadChecklistCatalog();
  const subsOf = new Map(catalog.items.map((it) => [it.item_key, it.substitutes]));
  const labelOf = new Map(catalog.items.map((it) => [it.item_key, it.item_label]));
  const out = items.map((it) => ({ ...it }));

  // (1) đã thay thế → không còn bắt buộc
  for (const it of out) {
    if (!it.required || it.status !== 'SUBSTITUTED') continue;
    it.required = false;
    it.message = `Không bắt buộc: đã có ${labelOf.get(it.substituted_by_item_key ?? '') ?? 'chứng từ thay thế'} thay thế.`;
  }

  // (2) nhóm thay thế cùng phạm vi đều chưa đạt → 1 yêu cầu
  const candidates = out.map((it, i) => ({ it, i })).filter(({ it, i }) => it.required && UNMET.includes(it.status) && allowSubstitute[i]);
  const linked = (a: ChecklistItemResult, b: ChecklistItemResult) =>
    (subsOf.get(a.item_key) ?? []).includes(b.item_key) || (subsOf.get(b.item_key) ?? []).includes(a.item_key);
  const seen = new Set<number>();
  for (const start of candidates) {
    if (seen.has(start.i)) continue;
    const group = [start];
    seen.add(start.i);
    for (let k = 0; k < group.length; k++) {
      for (const c of candidates) {
        if (seen.has(c.i) || scopeKey(c.it) !== scopeKey(group[k].it) || !linked(c.it, group[k].it)) continue;
        seen.add(c.i);
        group.push(c);
      }
    }
    if (group.length < 2) continue;
    // Đại diện của nhóm: mục có việc cụ thể để làm trước (scan lại, rà soát, bản đã nộp nhưng hết hạn), rồi số thứ tự nhỏ.
    const rank = (it: ChecklistItemResult) => PRIORITY[it.status] * 2 + (it.status === 'MISSING' && it.expired_evidence_ids.length > 0 ? 0 : 1);
    const kept = [...group].sort((a, b) => rank(a.it) - rank(b.it) || a.it.item_no - b.it.item_no)[0].it;
    for (const { it } of group) {
      if (it === kept) continue;
      Object.assign(it, {
        required: false, status: 'NOT_APPLICABLE', reason_code: 'COVERED_BY_ALTERNATIVE', suggested_action: 'NONE',
        message: `Không bắt buộc riêng: chỉ cần ${kept.item_label} hoặc chứng từ này.`,
      });
    }
  }

  // Mục còn bắt buộc mà thay thế được: ghi các lựa chọn để Sale biết nộp một trong các chứng từ là đủ.
  out.forEach((it, i) => {
    if (!it.required || !UNMET.includes(it.status) || !allowSubstitute[i]) return;
    const alts = (subsOf.get(it.item_key) ?? []).map((k) => labelOf.get(k)).filter(Boolean);
    if (alts.length === 0) return;
    const hint = `Có thể nộp thay bằng: ${alts.join(' hoặc ')}.`;
    it.note = it.note ? `${it.note} ${hint}` : hint;
  });
  return out;
}
