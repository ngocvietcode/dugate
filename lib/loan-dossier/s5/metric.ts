// So khớp METRIC (T-S5-04/05; S5-R07, R10) và SEMANTIC (T-S5-06; S5-R11).

export interface MetricValue { value: number; metric: string | null; period: string | null; unit: string | null }

export type Verdict = {
  match_status: 'MATCH' | 'NEAR_MATCH' | 'MISMATCH' | 'UNDETERMINED';
  reason_code: string;
  severity: 'INFO' | 'REVIEW' | 'HIGH';
  reason: string;
};

/** Chỉ so khi metric, period, unit tương thích (cùng giá trị hoặc cùng null). */
export function compareMetric(values: readonly MetricValue[]): Verdict {
  const sig = new Set(values.map((v) => `${v.metric}|${v.period}|${v.unit}`));
  if (sig.size > 1) return { match_status: 'UNDETERMINED', reason_code: 'METRIC_INCOMPATIBLE', severity: 'REVIEW', reason: 'Các chứng từ ghi chỉ số khác kỳ hoặc khác bản chất; không so trực tiếp được.' };
  const nums = new Set(values.map((v) => v.value));
  return nums.size === 1
    ? { match_status: 'MATCH', reason_code: 'EXACT_MATCH', severity: 'INFO', reason: 'Giá trị khớp giữa các chứng từ.' }
    : { match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', severity: 'REVIEW', reason: 'Giá trị khác nhau giữa các chứng từ.' };
}

export type SemanticLabel = 'SAME' | 'DIFFERENT' | 'UNSURE';

export interface SemanticPort {
  /** Nhiệt độ 0; chỉ nhận 2 chuỗi giá trị. Ném lỗi khi LLM lỗi/timeout. */
  judge(a: string, b: string): Promise<string>;
}

const norm = (s: string) => s.normalize('NFC').toLocaleUpperCase('vi-VN').replace(/\s+/g, ' ').trim();

/**
 * So từng giá trị với giá trị đầu tiên. Chuỗi giống hệt sau chuẩn hóa không cần gọi LLM.
 * `opts.defer` (D-57): giai đoạn tiếp nhận không gọi LLM — cặp cần LLM được hoãn (`SEMANTIC_DEFERRED`), so ở giai đoạn thẩm định.
 */
export async function compareSemantic(values: readonly string[], port: SemanticPort | null, opts: { defer?: boolean } = {}): Promise<Verdict> {
  const [first, ...rest] = values;
  const labels: SemanticLabel[] = [];
  for (const v of rest) {
    if (norm(v) === norm(first)) { labels.push('SAME'); continue; }
    if (opts.defer) return deferred();
    if (!port) return unavailable();
    let label: string;
    try {
      label = await port.judge(first, v);
    } catch {
      return unavailable();
    }
    if (label !== 'SAME' && label !== 'DIFFERENT' && label !== 'UNSURE') return unavailable();
    labels.push(label);
  }
  if (labels.every((l) => l === 'SAME')) return { match_status: 'MATCH', reason_code: 'SEMANTIC_MATCH', severity: 'INFO', reason: 'Nội dung cùng bản chất giữa các chứng từ.' };
  if (labels.includes('DIFFERENT')) return { match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', severity: 'REVIEW', reason: 'Nội dung khác nhau giữa các chứng từ.' };
  return { match_status: 'MISMATCH', reason_code: 'VALUE_CONFLICT', severity: 'REVIEW', reason: 'Không chắc chắn nội dung giữa các chứng từ là cùng bản chất; cần rà soát.' };
}

export const SEMANTIC_DEFERRED_CODE = 'SEMANTIC_DEFERRED';

function deferred(): Verdict {
  return { match_status: 'UNDETERMINED', reason_code: SEMANTIC_DEFERRED_CODE, severity: 'INFO', reason: 'Chưa so ngữ nghĩa ở giai đoạn tiếp nhận; sẽ so khi chạy giai đoạn thẩm định.' };
}

function unavailable(): Verdict {
  return { match_status: 'UNDETERMINED', reason_code: 'SEMANTIC_UNAVAILABLE', severity: 'REVIEW', reason: 'Không so được bằng ngữ nghĩa (dịch vụ không phản hồi); cần rà soát.' };
}

export function semanticPrompt(a: string, b: string): string {
  return [
    'Hai giá trị sau (từ hai chứng từ khác nhau) có cùng bản chất không? Trả DUY NHẤT một nhãn: SAME, DIFFERENT hoặc UNSURE.',
    `A: ${a}`,
    `B: ${b}`,
  ].join('\n');
}
