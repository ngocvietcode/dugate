// Chuyển DossierPrecheck thành dữ liệu hiển thị. Thuần, test bằng fixture (T-V2-14).
import type { DossierFile } from '@/app/loan-appraisal/types';
import type { DossierPrecheck, PrecheckLine, PrecheckLineStatus, PrecheckRelationStatus } from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';
import type { Tone } from './tone';

export const LINE_STATUS_LABEL: Record<PrecheckLineStatus, string> = {
  PROVIDED: 'Đã có', MISSING: 'Thiếu', UNCERTAIN: 'Cần kiểm tra', NOT_APPLICABLE: 'Không áp dụng',
};
export const RELATION_STATUS_LABEL: Record<PrecheckRelationStatus, string> = {
  CONSISTENT: 'Khớp', INCONSISTENT: 'Có điểm lệch', UNCLEAR: 'Chưa rõ',
};

export function lineTone(status: PrecheckLineStatus): Tone {
  if (status === 'PROVIDED') return 'success';
  if (status === 'MISSING') return 'warning';
  if (status === 'UNCERTAIN') return 'warning';
  return 'neutral';
}
export function relationTone(status: PrecheckRelationStatus): Tone {
  if (status === 'CONSISTENT') return 'success';
  if (status === 'INCONSISTENT') return 'warning';
  return 'warning';
}

export interface PrecheckBanner { tone: Tone; text: string }

/** Dòng kết luận ở đầu thẻ. `UNAVAILABLE` / `SKIPPED` luôn nói rõ là CHƯA đánh giá, không bao giờ ra "không thiếu". */
export function precheckBanner(p: DossierPrecheck): PrecheckBanner {
  if (p.status === 'UNAVAILABLE') return { tone: 'warning', text: 'Chưa đánh giá được checklist và quan hệ hồ sơ.' };
  if (p.status === 'SKIPPED') return { tone: 'neutral', text: 'Bước kiểm tra sơ bộ không chạy.' };
  const { MISSING, UNCERTAIN } = p.by_status;
  if (p.overall === 'GAPS_FOUND') {
    return { tone: 'warning', text: `Còn ${MISSING} mục thiếu, ${UNCERTAIN} mục cần kiểm tra${p.relations.some((r) => r.status === 'INCONSISTENT') ? ', có điểm lệch giữa các chứng từ' : ''}.` };
  }
  return { tone: 'success', text: 'AI chưa phát hiện thiếu sót ở bước sơ bộ (chưa phải kết luận cuối).' };
}

export interface LineView extends PrecheckLine { docs: string[] }

export interface LineGroupView { group: string; label: string; lines: LineView[] }

/** Mục không áp dụng (điều kiện không xảy ra với hồ sơ này) không có giá trị với Sale nên không hiển thị. */
export const isShownLine = (l: PrecheckLine): boolean => l.status !== 'NOT_APPLICABLE';

/** Tên file hiển thị lấy theo `file_id` từ S1 (LLM không nhìn thấy tên file). Bỏ mục không áp dụng. */
export function lineViews(p: DossierPrecheck, files: ReadonlyArray<DossierFile>): LineGroupView[] {
  const nameOf = new Map(files.map((f) => [f.file_id, f.file_name]));
  const out = new Map<string, LineGroupView>();
  for (const l of p.checklist.filter(isShownLine)) {
    const g = out.get(l.group) ?? { group: l.group, label: l.group_label, lines: [] };
    g.lines.push({ ...l, docs: [...new Set(l.evidence.map((e) => nameOf.get(e.file_id) ?? e.file_id))] });
    out.set(l.group, g);
  }
  return [...out.values()];
}

/** Toàn bộ dòng có trạng thái `status` (đủ, không cắt bớt), giữ thứ tự checklist, kèm tên nhóm để đọc độc lập. */
export function linesWithStatus(p: DossierPrecheck, files: ReadonlyArray<DossierFile>, status: PrecheckLineStatus): LineView[] {
  return lineViews(p, files).flatMap((g) => g.lines.filter((l) => l.status === status));
}

/** Số đếm hiển thị: không có `NOT_APPLICABLE`. */
export const SHOWN_STATUSES = ['PROVIDED', 'MISSING', 'UNCERTAIN'] as const satisfies ReadonlyArray<PrecheckLineStatus>;

export function relationDocs(evidence: DossierPrecheck['relations'][number]['evidence'], files: ReadonlyArray<DossierFile>): string[] {
  const nameOf = new Map(files.map((f) => [f.file_id, f.file_name]));
  return [...new Set(evidence.map((e) => nameOf.get(e.file_id) ?? e.file_id))];
}

/** Kết quả cuối (`result.dossier_precheck`) ưu tiên hơn bản giữa chừng của reducer. */
export function pickPrecheck(finalResult: DossierPrecheck | null | undefined, midRun: DossierPrecheck | null): DossierPrecheck | null {
  return finalResult ?? midRun ?? null;
}
// ─── Tổng quan giai đoạn 1 cho Sale: nhìn qua biết ngay tình trạng hồ sơ ────────────────────────

export interface Phase1Counts {
  provided: number;
  missing: number;
  uncertain: number;
  /** Quan hệ giữa chứng từ không khớp hoặc chưa rõ (không tính `CONSISTENT`). */
  relations_attention: number;
  relations_inconsistent: number;
  unclassified_files: number;
  /** Số mục đã có / số mục hiển thị (không tính "không áp dụng"); null khi chưa có mục nào. */
  coverage_percent: number | null;
  total: number;
}

export function phase1Counts(p: DossierPrecheck | null, files: ReadonlyArray<DossierFile>): Phase1Counts {
  const shown = (p?.status === 'COMPLETED' ? p.checklist : []).filter(isShownLine);
  const count = (s: PrecheckLineStatus) => shown.filter((l) => l.status === s).length;
  const rels = p?.status === 'COMPLETED' ? p.relations : [];
  const provided = count('PROVIDED');
  const total = shown.length;
  return {
    provided, missing: count('MISSING'), uncertain: count('UNCERTAIN'), total,
    relations_attention: rels.filter((r) => r.status !== 'CONSISTENT').length,
    relations_inconsistent: rels.filter((r) => r.status === 'INCONSISTENT').length,
    unclassified_files: files.filter((f) => f.status !== 'CLASSIFIED').length,
    coverage_percent: total > 0 ? Math.round((provided / total) * 100) : null,
  };
}

export interface Phase1Verdict { tone: Tone; label: string; headline: string }

/**
 * Kết luận một dòng của giai đoạn 1. `UNAVAILABLE` / `SKIPPED` luôn nói rõ là CHƯA đánh giá, không bao giờ ra "đạt".
 * Mức nghiêm trọng: thiếu chứng từ → đỏ; còn điểm cần kiểm tra / lệch / file chưa nhận diện → vàng; không còn gì → xanh.
 */
export function phase1Verdict(p: DossierPrecheck | null, files: ReadonlyArray<DossierFile>, running = false): Phase1Verdict {
  if (!p) {
    return running
      ? { tone: 'info', label: 'Đang kiểm tra', headline: 'AI đang đối chiếu checklist và quan hệ giữa các chứng từ...' }
      : { tone: 'neutral', label: 'Chưa có kết quả', headline: 'Chưa có kết quả kiểm tra sơ bộ.' };
  }
  if (p.status === 'UNAVAILABLE') return { tone: 'warning', label: 'Chưa đánh giá được', headline: 'Bước kiểm tra sơ bộ bằng AI không chạy được nên chưa có kết luận về checklist.' };
  if (p.status === 'SKIPPED') return { tone: 'neutral', label: 'Không kiểm tra', headline: 'Bước kiểm tra sơ bộ không chạy.' };
  const c = phase1Counts(p, files);
  const parts = [
    c.missing > 0 && `Thiếu ${c.missing} mục`,
    c.uncertain > 0 && `${c.uncertain} mục cần kiểm tra`,
    c.relations_attention > 0 && `${c.relations_attention} điểm lệch giữa chứng từ`,
    c.unclassified_files > 0 && `${c.unclassified_files} tài liệu chưa nhận diện`,
  ].filter((x): x is string => typeof x === 'string');
  if (c.missing > 0) return { tone: 'warning', label: 'Cần bổ sung', headline: parts.join(' · ') };
  if (parts.length > 0) return { tone: 'warning', label: 'Cần kiểm tra', headline: parts.join(' · ') };
  return { tone: 'success', label: 'Đạt sơ bộ', headline: 'AI chưa phát hiện thiếu sót ở bước sơ bộ (chưa phải kết luận cuối).' };
}

const URGENCY: Record<PrecheckLineStatus, number> = { MISSING: 0, UNCERTAIN: 1, PROVIDED: 2, NOT_APPLICABLE: 3 };

/** Sắp mục cần xử lý lên đầu nhóm (thiếu → cần kiểm tra → đã có), giữ thứ tự checklist trong cùng trạng thái. */
export function byUrgency<T extends { status: PrecheckLineStatus }>(lines: ReadonlyArray<T>): T[] {
  return lines.map((l, i) => ({ l, i })).sort((a, b) => URGENCY[a.l.status] - URGENCY[b.l.status] || a.i - b.i).map((x) => x.l);
}
