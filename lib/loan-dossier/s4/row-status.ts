// Quyết định trạng thái dòng (T-S4-07; S4-R13, R14, R16, R18, R19, R23).
import { evaluateValidity, minimumIssueDate, type ValidityResult } from '../common/validity';
import { evaluateBirthCertRow, type RelationshipCheck } from './birth-cert';
import { itemByKey, type ChecklistItem } from './catalog';
import type { ChecklistContext, ConditionResult } from './context';
import type { RequiredResult } from './required';
import type { Candidate, CandidateIndex, HeldBack, Row } from './rows';

export type RowStatus = 'PRESENT' | 'SUBSTITUTED' | 'MISSING' | 'NEEDS_RESCAN' | 'NEEDS_REVIEW' | 'NOT_APPLICABLE';

export interface RowDecision {
  status: RowStatus;
  reason_code: string;
  message: string;
  found_in: Candidate[];
  substituted_by_item_key: string | null;
  substituted_by_doc_type_key: string | null;
  expired_evidence_ids: string[];
  relationship_checks: RelationshipCheck[];
  note: string | null;
  suggested_action: 'NONE' | 'UPLOAD' | 'RESCAN' | 'REVIEW_CONTEXT';
}

const MESSAGE: Record<string, string> = {
  DOCUMENT_FOUND: 'Đã có chứng từ.',
  SUBSTITUTED_BY_ALLOWED_DOC: 'Đã có chứng từ thay thế được chấp nhận.',
  DOCUMENT_NOT_FOUND: 'Chưa có chứng từ trong hồ sơ.',
  DOCUMENT_EXPIRED: 'Chứng từ đã hết hiệu lực.',
  INSUFFICIENT_BIRTH_CERTIFICATES: 'Giấy khai sinh chưa đủ để xác minh quan hệ với chủ tài sản bảo đảm.',
  EXTRACTION_FAILED: 'Không đọc được chứng từ; cần scan lại.',
  ASSET_CONTEXT_UNRESOLVED: 'Chưa xác định được tài sản / mục đích sử dụng tài sản; cần rà soát.',
  CONFLICTING_DUPLICATES: 'Có nhiều bản cùng chứng từ với nội dung khác nhau; cần rà soát.',
  ROLE_CONFLICT_UNRESOLVED: 'Một vai trò khớp nhiều danh tính khác nhau; cần rà soát.',
  RELATIONSHIP_UNVERIFIED: 'Chưa xác minh được quan hệ với chủ tài sản bảo đảm; cần rà soát.',
  DOCUMENT_OWNER_UNCONFIRMED: 'Có chứng từ nhưng chưa xác nhận thuộc người này; cần rà soát.',
  ISSUE_DATE_UNREADABLE: 'Không đọc được ngày cấp để xác định hiệu lực; cần scan lại.',
  CONDITION_NOT_MET: 'Không áp dụng cho hồ sơ này.',
  NOT_REQUIRED_FOR_FLOW: 'Không bắt buộc với luồng này.',
  CONDITION_INPUT_NOT_PROVIDED: 'Thiếu thông tin để xác định chứng từ có bắt buộc không.',
};

const ACTION: Record<RowStatus, RowDecision['suggested_action']> = {
  PRESENT: 'NONE', SUBSTITUTED: 'NONE', NOT_APPLICABLE: 'NONE', MISSING: 'UPLOAD', NEEDS_RESCAN: 'RESCAN', NEEDS_REVIEW: 'REVIEW_CONTEXT',
};

const ruleOf = (item: ChecklistItem) => ({ validityDays: item.validity_days, ignorePrintedExpiry: item.ignore_printed_expiry });
const validityOf = (c: Candidate, item: ChecklistItem, d0: string): ValidityResult =>
  evaluateValidity({ issue_date: c.issue_date, valid_until: c.valid_until, recognition_only: c.recognition_only }, ruleOf(item), d0);
const isValid = (c: Candidate, item: ChecklistItem, d0: string) => {
  if (c.status !== 'SUCCESS' || c.duplicate_status === 'CONFLICTING_DUPLICATES') return false;
  const v = validityOf(c, item, d0);
  return v.dateOK && !v.expired;
};
const withEvidence = (cs: readonly Candidate[]) => cs.filter((c) => c.evidence_id !== null);

function decision(status: RowStatus, reason: string, found: readonly Candidate[], extra: Partial<RowDecision> = {}): RowDecision {
  return {
    status, reason_code: reason, message: MESSAGE[reason] ?? '', found_in: withEvidence(found), substituted_by_item_key: null,
    substituted_by_doc_type_key: null, expired_evidence_ids: [], relationship_checks: [], note: null, suggested_action: ACTION[status], ...extra,
  };
}

/** Ứng viên của item thay thế cùng phạm vi dòng (S4-R14). */
function substituteCandidates(sub: ChecklistItem, row: Row, index: CandidateIndex): Candidate[] {
  if (row.item.scope === 'PERSON') return index.forPerson(sub.accepted_doc_type_keys, row.person?.person_id ?? null);
  if (row.item.scope === 'ASSET') return row.asset ? index.forAsset(sub.accepted_doc_type_keys, row.asset.asset_id) : [];
  return index.forDossier(sub.accepted_doc_type_keys);
}

export function decideRowStatus(
  row: Row,
  condition: ConditionResult | null,
  req: RequiredResult,
  ctx: ChecklistContext,
  index: CandidateIndex,
): RowDecision {
  const { item } = row;
  const d0 = ctx.d0;
  const cands = row.candidates;
  const valid = cands.filter((c) => isValid(c, item, d0));
  const expired = cands.filter((c) => c.status === 'SUCCESS' && validityOf(c, item, d0).expired);
  const expiredIds = withEvidence(expired).map((c) => c.evidence_id!);
  const manualNote = valid.some((c) => c.needs_manual_review) ? 'Phân loại chứng từ có độ tin cậy thấp; cần rà soát lại loại chứng từ.' : null;

  if (!req.required) {
    if (valid.length > 0) return decision('PRESENT', 'DOCUMENT_FOUND', valid, { expired_evidence_ids: expiredIds, note: manualNote });
    const reason = condition === 'NOT_MET' ? 'CONDITION_NOT_MET' : condition === 'INPUT_NOT_PROVIDED' ? 'CONDITION_INPUT_NOT_PROVIDED' : 'NOT_REQUIRED_FOR_FLOW';
    return decision('NOT_APPLICABLE', reason, [], { expired_evidence_ids: expiredIds });
  }
  // #1
  if (req.forceReview && condition === 'INPUT_NOT_PROVIDED') return decision('NEEDS_REVIEW', 'ASSET_CONTEXT_UNRESOLVED', cands, { expired_evidence_ids: expiredIds });
  // #2
  if (item.scope === 'ASSET' && (!row.asset || row.asset.context_status !== 'CONFIRMED' || row.usage_context === null)) {
    return decision('NEEDS_REVIEW', 'ASSET_CONTEXT_UNRESOLVED', cands, { expired_evidence_ids: expiredIds });
  }
  // #3
  if (item.scope === 'PERSON' && row.person?.role_conflict && cands.length > 0) return decision('NEEDS_REVIEW', 'ROLE_CONFLICT_UNRESOLVED', cands, { expired_evidence_ids: expiredIds });
  // #4
  if (item.has_count_rule) {
    const b = evaluateBirthCertRow(row.person, cands, ctx);
    return decision(b.status, b.reason_code, b.found_in, { relationship_checks: b.relationship_checks, expired_evidence_ids: expiredIds });
  }
  // #5
  const conflicting = cands.filter((c) => c.status === 'SUCCESS' && c.duplicate_status === 'CONFLICTING_DUPLICATES');
  if (conflicting.length > 0) return decision('NEEDS_REVIEW', 'CONFLICTING_DUPLICATES', conflicting, { expired_evidence_ids: expiredIds });
  // #6 (+ S4-R23 (1): có cả bản hết hạn và bản còn hạn)
  if (valid.length > 0) {
    let note = manualNote;
    if (expired.length > 0) {
      const oldest = expired.map((c) => c.issue_date).filter(Boolean).sort()[0] ?? 'không rõ';
      const newest = valid.map((c) => c.issue_date).filter(Boolean).sort().reverse()[0] ?? 'không rõ';
      note = [`Bản cấp ngày ${oldest} đã hết hiệu lực; dùng bản cấp ngày ${newest}.`, manualNote].filter(Boolean).join(' ');
    }
    return decision('PRESENT', 'DOCUMENT_FOUND', valid, { expired_evidence_ids: expiredIds, note });
  }
  // #7
  if (cands.some((c) => c.status === 'ERROR') && !cands.some((c) => c.status === 'SUCCESS')) {
    return decision('NEEDS_RESCAN', 'EXTRACTION_FAILED', cands.filter((c) => c.status === 'ERROR'), { expired_evidence_ids: expiredIds });
  }
  // #8
  const undated = cands.filter((c) => c.status === 'SUCCESS' && !validityOf(c, item, d0).dateOK);
  if (undated.length > 0) return decision('NEEDS_RESCAN', 'ISSUE_DATE_UNREADABLE', undated, { expired_evidence_ids: expiredIds });
  // #9
  if (req.allowSubstitute) {
    for (const key of item.substitutes) {
      const sub = itemByKey(key);
      if (!sub) continue;
      const ok = substituteCandidates(sub, row, index).filter((c) => isValid(c, sub, d0));
      if (ok.length > 0) {
        return decision('SUBSTITUTED', 'SUBSTITUTED_BY_ALLOWED_DOC', ok, {
          substituted_by_item_key: sub.item_key, substituted_by_doc_type_key: ok[0].doc_type_key, expired_evidence_ids: expiredIds,
        });
      }
    }
  }
  // #10 (+ S4-R23 (2))
  if (expired.length > 0) {
    const old = expired.map((c) => c.issue_date).filter(Boolean).sort().reverse()[0];
    const basisPrinted = expired.some((c) => validityOf(c, item, d0).basis === 'PRINTED_EXPIRY');
    const ask = item.validity_days !== null && !basisPrinted
      ? `Cần bổ sung bản cấp từ ngày ${minimumIssueDate(item.validity_days, d0)} trở đi.`
      : 'Cần bổ sung bản còn hạn.';
    const head = item.validity_days !== null && !basisPrinted
      ? `Chứng từ${old ? ` cấp ngày ${old}` : ''} đã quá thời hạn ${item.validity_days} ngày.`
      : 'Chứng từ đã quá ngày hết hạn in trên giấy.';
    return decision('MISSING', 'DOCUMENT_EXPIRED', expired, { message: `${head} ${ask}`, expired_evidence_ids: expiredIds });
  }
  // #10.5 (S4-R28, D-64): có chứng từ đúng loại nhưng chưa gán chắc cho người này → cần rà soát, không báo thiếu
  const held = row.held_back ?? [];
  if (item.scope === 'PERSON' && cands.length === 0 && held.length > 0) {
    const own = row.person?.role_conflict === true && held.every((h) => h.why === 'MULTIPLE_IDENTITIES_FOR_ROLE');
    const reason = own ? 'ROLE_CONFLICT_UNRESOLVED' : 'DOCUMENT_OWNER_UNCONFIRMED';
    return decision('NEEDS_REVIEW', reason, held.map((h) => h.candidate), { message: heldBackMessage(item, row, held), expired_evidence_ids: expiredIds });
  }
  // #11
  if (condition === 'INPUT_NOT_PROVIDED') return decision('MISSING', 'CONDITION_INPUT_NOT_PROVIDED', [], { note: misclassifiedNote(item, index) });
  // #12
  return decision('MISSING', 'DOCUMENT_NOT_FOUND', [], { note: misclassifiedNote(item, index) });
}

/** S4-R28: nêu chứng từ có trong hồ sơ nhưng chưa xác nhận thuộc người này, kèm lý do cụ thể. */
function heldBackMessage(item: ChecklistItem, row: Row, held: readonly HeldBack[]): string {
  const who = row.person?.full_name ?? 'người này';
  const parts = held.map((h) => {
    const c = h.candidate;
    const where = `${c.file_name}${c.page ? ` tr.${c.page}` : ''}`;
    if (h.why === 'NAME_SPELLING_DIFFERENCE') return `${where}: tên trên chứng từ (${h.seen_name ?? 'không rõ'}) khác chính tả với ${who}`;
    if (h.why === 'AMBIGUOUS_IDENTITY_MATCH') return `${where}: người trên chứng từ (${h.seen_name ?? 'không rõ'}) khớp nhiều người trong hồ sơ`;
    return `${where}: danh tính trên chứng từ có xung đột nên chưa gán chắc cho ${who}`;
  });
  return `Hồ sơ có "${item.item_label}" nhưng chưa xác nhận thuộc ${who} — ${parts.join('; ')}. Cần rà soát, không phải thiếu chứng từ.`;
}

/** S4-R26: nêu bản bị nhận nhầm là loại của mục (để RM biết vì sao vẫn thiếu dù có file "trông giống"). */
function misclassifiedNote(item: ChecklistItem, index: CandidateIndex): string | null {
  const wrong = index.misclassifiedOf(item.accepted_doc_type_keys);
  if (wrong.length === 0) return null;
  const where = wrong.map((m) => `${m.file_name} tr.${m.page_range[0]}–${m.page_range[1]}`).join('; ');
  return `Đã kiểm ${where}: không phải "${item.item_label}" (được nhận diện nhầm loại), nên không tính cho mục này.`;
}
