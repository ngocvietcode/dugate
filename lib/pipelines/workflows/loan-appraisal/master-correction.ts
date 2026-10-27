// Hiệu chỉnh master_dossier bằng LLM (MD-R16, MD-R18; D-67…D-69). Chạy cùng S3–S5 (giai đoạn 2; giai đoạn 1 nếu intake_run_consolidate = true), sau khi dựng master.
//   1. `proposeMasterCorrections` (tất định) chọn trường CONFLICT đủ căn cứ (G1…G4).
//   2. MỘT lời gọi LLM (step key `master_correction`) chọn `option_id` trong các giá trị đã đọc — không trả giá trị.
//   3. `applyMasterCorrections` kiểm tra (V1, V2) và áp dụng; quyết định lưu ở checkpoint bước 2 nên resume không gọi lại.
// Lỗi LLM / phản hồi sai định dạng → không hiệu chỉnh trường nào, stage không đổ. Cảnh báo không chứa giá trị trường (PII).
import { z } from 'zod';

import type { MasterDossier } from '@/lib/loan-dossier/contracts/master-dossier';
import {
  applyMasterCorrections,
  proposeMasterCorrections,
  type CorrectionDecision,
  type CorrectionProposal,
} from '@/lib/loan-dossier/master/correct';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

import { untrustedBlock } from '../prompts/loan-appraisal-prompts';
import { renderPrompt } from './prompt-render';

export const MASTER_CORRECTION_STEP = 'master_correction';
/** Số trường tối đa gửi trong một lời gọi; phần còn lại giữ CONFLICT (có cảnh báo). */
export const MAX_CORRECTION_PROPOSALS = 40;
const FACTS_CHAR_BUDGET = 16_000;
const MAX_DECISIONS = 200;

export const MASTER_CORRECTION_OUTPUT_SCHEMA =
  '{ "decisions": [{ "proposal_id": "<mã trong dữ kiện>", "action": "SELECT|KEEP_CONFLICT", "option_id": "<option_id trong chính trường đó, hoặc null>", "reason": "<tối đa 200 ký tự>" }] }';

export const MASTER_CORRECTION_PROMPT_TEMPLATE = `Bạn là trợ lý rà soát dữ liệu bóc tách (OCR) của bộ hồ sơ vay. Mỗi TRƯỜNG dưới đây được đọc ra các giá trị khác nhau giữa các bản của cùng một chứng từ hoặc giữa các chứng từ. Các giá trị chỉ lệch nhau vài ký tự nên nhiều khả năng một hoặc nhiều bản bị đọc sai. Bộ hồ sơ đã qua sàng lọc ở bước trước và nhìn chung là chính xác: khi có căn cứ hợp lý thì hãy chọn, đừng giữ xung đột chỉ vì hai bản ngang nhau.
Nhiệm vụ: với từng trường, CHỌN giá trị đúng nhất trong các lựa chọn đã đọc, hoặc giữ nguyên trạng thái xung đột nếu thật sự không có căn cứ.

QUY TẮC BẮT BUỘC:
1. CHỈ chọn trong các lựa chọn (option_id) của chính trường đó. KHÔNG tự tạo, sửa hay ghép giá trị mới; không trả giá trị, chỉ trả option_id.
2. Căn cứ để chọn, theo thứ tự ưu tiên: (a) la_chung_tu_chuan = true: lựa chọn có trên chứng từ gốc của trường này thì đáng tin hơn bản đối chiếu; (b) dung_dinh_dang: false nghĩa là giá trị sai định dạng (CCCD không đủ 9 hoặc 12 chữ số, ngày không tồn tại) nên gần như chắc chắn là đọc sai; (c) so_nguon nhiều hơn; (d) do_tin_cay cao hơn; (e) kiểu lỗi đọc thường gặp (nhầm 0/O, 1/I/l, 5/S, 8/B, 6/G, thiếu hoặc thừa một ký tự, mất hoặc sai dấu tiếng Việt, hoán đổi hai ký tự liền kề). Chỉ dùng thông tin trong DỮ KIỆN.
3. Hai lựa chọn ngang nhau về mọi căn cứ ở mục 2 (cùng số nguồn, cùng độ tin cậy, đều đúng định dạng, không bên nào là chứng từ gốc), hoặc hai giá trị đều có thể là thật (ví dụ hai số khác nhau có thật) → action = KEEP_CONFLICT, option_id = null. Chỉ cần MỘT căn cứ ở mục 2 nghiêng rõ về một phía là đủ để chọn.
4. action = SELECT thì option_id bắt buộc và phải thuộc đúng trường đó.
5. reason: tiếng Việt, tối đa 200 ký tự, nêu căn cứ ngắn gọn. Không nhắc lại toàn bộ giá trị.
6. Trả đủ một quyết định cho mỗi proposal_id trong dữ kiện.

DỮ KIỆN CÁC TRƯỜNG CẦN CHỌN:
{{proposals}}

CHỈ trả về JSON đúng schema sau, không kèm lời dẫn hay markdown:
{{output_schema}}`;

const DecisionSchema = z.object({
  proposal_id: z.string().min(1).max(40),
  action: z.enum(['SELECT', 'KEEP_CONFLICT']),
  option_id: z.string().max(20).nullish(),
  reason: z.string().max(2000).nullish(),
});
const ResponseSchema = z.object({ decisions: z.array(z.unknown()).max(MAX_DECISIONS) });

/** Quyết định của LLM lưu ở checkpoint bước 2 để resume không gọi lại. */
export interface MasterCorrectionCache {
  /** Tập mã đề xuất đã gửi; cache chỉ dùng khi tập hiện tại giống hệt (MD-R18). */
  proposal_ids: string[];
  decisions: CorrectionDecision[];
  warnings: string[];
  prompt_overridden: boolean;
}

export function isMasterCorrectionCache(v: unknown): v is MasterCorrectionCache {
  return !!v && typeof v === 'object' && Array.isArray((v as MasterCorrectionCache).proposal_ids)
    && Array.isArray((v as MasterCorrectionCache).decisions) && Array.isArray((v as MasterCorrectionCache).warnings);
}

/** Cổng gọi model: trả nội dung đã parse JSON (hoặc chuỗi thô). Ném lỗi khi model lỗi / timeout. */
export type AskMasterCorrection = (step: typeof MASTER_CORRECTION_STEP, prompt: string) => Promise<unknown>;

/** Dữ kiện đưa vào prompt: không có khóa so nội bộ; mỗi lựa chọn kèm nguồn và độ tin cậy. */
export function buildCorrectionFacts(proposals: ReadonlyArray<CorrectionProposal>): unknown[] {
  return proposals.map((p) => ({
    proposal_id: p.proposal_id,
    thuoc: p.scope_label,
    truong: p.label,
    loai: p.kind,
    lua_chon: p.options.map((o) => ({
      option_id: o.option_id,
      gia_tri: o.value,
      so_nguon: new Set(o.evidence_ids.map((r) => r.split('#')[0])).size,
      do_tin_cay: o.confidence,
      la_chung_tu_chuan: o.canonical,
      dung_dinh_dang: o.format_ok,
      nguon: o.where,
    })),
  }));
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** MỘT lời gọi LLM cho mọi đề xuất. Ném lại lỗi huỷ (`isPassThroughError`) để operation bị huỷ không bị nuốt. */
export async function runMasterCorrection(
  proposals: ReadonlyArray<CorrectionProposal>,
  ask: AskMasterCorrection,
  overrides: Readonly<Record<string, string | undefined>>,
  isPassThroughError: (err: unknown) => boolean = () => false,
): Promise<MasterCorrectionCache> {
  const warnings: string[] = [];
  const decisions: CorrectionDecision[] = [];
  const prompt_overridden = Boolean(overrides[MASTER_CORRECTION_STEP]);
  try {
    const facts = JSON.stringify(buildCorrectionFacts(proposals));
    if (facts.length > FACTS_CHAR_BUDGET) warnings.push('Dữ kiện hiệu chỉnh quá dài, đã cắt bớt; các trường bị cắt giữ nguyên trạng thái xung đột.');
    const prompt = renderPrompt(overrides[MASTER_CORRECTION_STEP] || MASTER_CORRECTION_PROMPT_TEMPLATE, ['proposals', 'output_schema'], {
      proposals: untrustedBlock('untrusted_correction_facts', facts.length <= FACTS_CHAR_BUDGET ? facts : `${facts.slice(0, FACTS_CHAR_BUDGET)}…(đã cắt bớt)`),
      output_schema: MASTER_CORRECTION_OUTPUT_SCHEMA,
    });
    const parsed = ResponseSchema.safeParse(await ask(MASTER_CORRECTION_STEP, prompt));
    if (!parsed.success) {
      warnings.push('Phản hồi hiệu chỉnh master không đúng định dạng; không hiệu chỉnh trường nào.');
    } else {
      let dropped = 0;
      for (const raw of parsed.data.decisions) {
        const d = DecisionSchema.safeParse(raw);
        if (!d.success) { dropped += 1; continue; }
        decisions.push({ proposal_id: d.data.proposal_id, action: d.data.action, option_id: d.data.option_id ?? null, reason: (d.data.reason ?? '').slice(0, 200) });
      }
      if (dropped > 0) warnings.push(`${dropped} quyết định hiệu chỉnh sai định dạng đã bị bỏ qua.`);
    }
  } catch (err) {
    if (isPassThroughError(err)) throw err;
    warnings.push(`Không gọi được LLM hiệu chỉnh master (${err instanceof Error ? err.name : 'Error'}); không hiệu chỉnh trường nào.`);
  }
  return { proposal_ids: proposals.map((p) => p.proposal_id), decisions, warnings, prompt_overridden };
}

export interface ResolveMasterCorrectionInput {
  master: MasterDossier | null;
  evidences: ReadonlyArray<EvidenceEnvelope>;
  enabled: boolean;
  cached: unknown;
  ask: AskMasterCorrection;
  overrides: Readonly<Record<string, string | undefined>>;
  isPassThroughError?: (err: unknown) => boolean;
}

export interface ResolveMasterCorrectionResult {
  /** Master sau hiệu chỉnh (cùng tham chiếu với đầu vào khi không có gì đổi). */
  master: MasterDossier | null;
  /** Cache mới cần ghi vào checkpoint; null nếu không gọi LLM (đã có cache hợp lệ, tắt, hoặc không có đề xuất). */
  fresh: MasterCorrectionCache | null;
  warnings: string[];
  proposals: number;
}

/** MD-R16…R18: đề xuất → (cache | LLM) → áp dụng. Hàm bất đồng bộ duy nhất của hiệu chỉnh. */
export async function resolveMasterCorrection(input: ResolveMasterCorrectionInput): Promise<ResolveMasterCorrectionResult> {
  const { master } = input;
  if (!master || !input.enabled) return { master, fresh: null, warnings: [], proposals: 0 };
  const all = proposeMasterCorrections(master, input.evidences);
  if (all.length === 0) return { master, fresh: null, warnings: [], proposals: 0 };
  const sendable = all.slice(0, MAX_CORRECTION_PROPOSALS);
  const warnings: string[] = all.length > sendable.length
    ? [`Có ${all.length} trường cần hiệu chỉnh, chỉ gửi ${sendable.length} trường đầu; phần còn lại giữ trạng thái xung đột.`]
    : [];
  const cached = isMasterCorrectionCache(input.cached) && sameSet(input.cached.proposal_ids, sendable.map((p) => p.proposal_id)) ? input.cached : null;
  const cache = cached ?? await runMasterCorrection(sendable, input.ask, input.overrides, input.isPassThroughError);
  return {
    master: applyMasterCorrections(master, sendable, cache.decisions),
    fresh: cached ? null : cache,
    warnings: [...warnings, ...(cached ? [] : cache.warnings)],
    proposals: sendable.length,
  };
}
