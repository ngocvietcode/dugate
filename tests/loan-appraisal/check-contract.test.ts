import {
  DEFAULT_MODEL_CODES,
  UNKNOWN_CODE,
  allowedCodes,
  modelCheckJsonSchema,
  parseModelCheckOutput,
  resolveModelCode,
  toCheckResult,
} from '@/lib/pipelines/workflows/loan-appraisal/check-contract';
import {
  CHECK_KINDS,
  CheckSchema,
  INTEGRATION_SCHEMA_VERSION,
  IntegrationPayloadSchema,
  OUTCOMES,
  integrationJsonSchema,
} from '@/lib/pipelines/workflows/loan-appraisal/integration-contract';
import { DEFAULT_CHECK_SET, LOAN_CHECK_CATALOG, parseCheckSet, validateCheckSetValue } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { parsePromptCheckResults, buildPromptCheckVars } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';
import { parseIntegrationIncludes } from '@/lib/pipelines/workflows/loan-appraisal/integration-payload';
import type { EvidenceRecord, EvidenceRegistry, FinancialMetrics, RuleResult } from '@/lib/pipelines/workflows/loan-appraisal/types';

const rule = (extra: Partial<RuleResult>): RuleResult => ({
  rule_id: 'LOAN.TEST.X', rule_version: '1.0.0', severity: 'REVIEW', exception_allowed: false, result: 'PASS',
  reason_code: 'OK', message: 'm', evidence_ids: [], ...extra,
});

describe('toCheckResult — một hình dạng cho ENGINE / LLM / AGENT', () => {
  it('rule engine đạt: có measure, không message, không code, không confidence', () => {
    const c = toCheckResult(rule({ rule_id: 'LOAN.CAPACITY.MIN_DSCR', check_kind: 'DETERMINISTIC', result: 'PASS', reason_code: 'DSCR_THRESHOLD_MET', expected: { minimum: 1.25 }, actual: 1.4 }));
    expect(c).toEqual({ id: 'LOAN.CAPACITY.MIN_DSCR', ver: '1.0.0', kind: 'ENGINE', group: 'CAPACITY', outcome: 'PASS', severity: 'REVIEW', measure: { expected: { minimum: 1.25 }, actual: 1.4 } });
    expect(CheckSchema.safeParse(c).success).toBe(true);
  });

  it('rule engine không đạt: có code + message + measure + exception', () => {
    const c = toCheckResult(rule({ rule_id: 'LOAN.CAPACITY.MIN_DSCR', check_kind: 'DETERMINISTIC', result: 'FAIL', severity: 'BLOCKER', exception_allowed: true, reason_code: 'DSCR_BELOW_MINIMUM', message: 'DSCR thấp', expected: { minimum: 1.25 }, actual: 0.9 }));
    expect(c).toMatchObject({ kind: 'ENGINE', group: 'CAPACITY', outcome: 'FAIL', severity: 'BLOCKER', code: 'DSCR_BELOW_MINIMUM', message: 'DSCR thấp', exception: true });
  });

  it('rule LLM đạt: chỉ có confidence, không measure/code/message; PROMPT_CHECK_PASS không lặp thành code', () => {
    const c = toCheckResult(rule({ check_kind: 'PROMPT', result: 'PASS', reason_code: 'PROMPT_CHECK_PASS', confidence: 0.93, expected: { input: ['a'] } }));
    expect(c).toMatchObject({ kind: 'LLM', outcome: 'PASS', confidence: 0.93 });
    for (const k of ['code', 'measure', 'message']) expect(c).not.toHaveProperty(k);
  });

  it('rule LLM không đạt: mã hệ thống thay cho PROMPT_CHECK_*; mã đóng do model chọn được ưu tiên', () => {
    expect(toCheckResult(rule({ check_kind: 'PROMPT', result: 'NOT_RUN', reason_code: 'PROMPT_CHECK_NOT_RETURNED' })).code).toBe('NOT_RETURNED');
    expect(toCheckResult(rule({ check_kind: 'PROMPT', result: 'REVIEW', reason_code: 'PROMPT_CHECK_BELOW_THRESHOLD' })).code).toBe('BELOW_THRESHOLD');
    expect(toCheckResult(rule({ check_kind: 'PROMPT', result: 'FAIL', reason_code: 'PROMPT_CHECK_FAIL', confidence: 0.9 }), { modelCode: 'OWNER_DIFFERENT' }).code).toBe('OWNER_DIFFERENT');
  });

  it('rule AGENT dùng cùng hình dạng như LLM; thêm AGENT KHÔNG đổi schema', () => {
    const agent = toCheckResult(rule({ check_kind: 'PROMPT', result: 'FAIL', reason_code: 'PROMPT_CHECK_FAIL', confidence: 0.88, message: 'khác chủ sở hữu' }), { kind: 'AGENT', modelCode: 'OWNER_DIFFERENT' });
    const llm = toCheckResult(rule({ check_kind: 'PROMPT', result: 'FAIL', reason_code: 'PROMPT_CHECK_FAIL', confidence: 0.88, message: 'khác chủ sở hữu' }), { modelCode: 'OWNER_DIFFERENT' });
    expect(agent.kind).toBe('AGENT');
    expect({ ...agent, kind: 'LLM' }).toEqual(llm);
    expect(CheckSchema.safeParse(agent).success).toBe(true);
    expect(CHECK_KINDS).toEqual(['ENGINE', 'LLM', 'AGENT', 'EXTERNAL']);
  });

  it('thêm kiểm tra mới là thêm phần tử mảng: schema không đổi và không dùng id làm tên khóa', () => {
    const base = { schema: 'dugate.loan-appraisal.integration', schema_version: INTEGRATION_SCHEMA_VERSION };
    const payload = (checks: unknown[]) => ({
      ...base,
      case: { id: 'x', profile: { segment: 'SME', product: 'sme', catalog: { checks: '1', documents: '3' } } },
      decision: { status: 'PARTIAL', recommendation: 'REFER', route: 'RISK_REVIEW', review_required: true, reason_codes: [] },
      extractions: [], financials: [], checks, checks_summary: { status: 'PASS', total: checks.length, by_outcome: [] },
    });
    // Khối kiểm tra hồ sơ là tuỳ chọn (tạm tắt ở giai đoạn 2) nhưng khi có phải hợp lệ như trước.
    const withDossierChecks = (checks: unknown[]) => ({
      ...payload(checks),
      parties: [], assets: [], documents: { readiness: 'READY_FOR_APPRAISAL', completeness_percent: 100, required_present: 0, required_total: 0, by_group: [], items: [], records: [], issues: [] },
      findings: [],
    });
    const one = toCheckResult(rule({ check_kind: 'DETERMINISTIC' }));
    const many = [one, ...Array.from({ length: 30 }, (_, i) => toCheckResult(rule({ rule_id: `LOAN.NEW.R${i}`, check_kind: i % 2 ? 'PROMPT' : 'DETERMINISTIC' }), { kind: i % 3 === 0 ? 'AGENT' : undefined }))];
    expect(IntegrationPayloadSchema.safeParse(payload([one])).success).toBe(true);
    expect(IntegrationPayloadSchema.safeParse(payload(many)).success).toBe(true);
    expect(IntegrationPayloadSchema.safeParse(withDossierChecks(many)).success).toBe(true);
    // Thiếu extractions (khối bắt buộc duy nhất của phần hồ sơ) thì không hợp lệ.
    const { extractions: _omit, ...noExtractions } = payload(many);
    expect(IntegrationPayloadSchema.safeParse(noExtractions).success).toBe(false);
  });
});

describe('contract: enum đóng, strict, JSON Schema công bố', () => {
  it('outcome là 6 giá trị cố định', () => {
    expect(OUTCOMES).toEqual(['PASS', 'FAIL', 'REVIEW', 'INSUFFICIENT_DATA', 'NOT_RUN', 'NOT_APPLICABLE']);
  });

  it('strict: field lạ bị từ chối ở schema (để lỗi builder lộ ra khi test, không lọt ra consumer)', () => {
    const ok = toCheckResult(rule({}));
    expect(CheckSchema.safeParse({ ...ok, evidence_ids: ['x'] }).success).toBe(false);
    expect(CheckSchema.safeParse({ ...ok, outcome: 'MAYBE' }).success).toBe(false);
  });

  it('JSON Schema sinh từ chính schema runtime, có thể công bố cho consumer', () => {
    const js = integrationJsonSchema() as { type?: string; properties?: Record<string, unknown>; required?: string[] };
    expect(js.type).toBe('object');
    expect(Object.keys(js.properties ?? {})).toEqual(expect.arrayContaining(['schema', 'schema_version', 'case', 'decision', 'extractions', 'parties', 'assets', 'documents', 'findings', 'financials', 'checks', 'checks_summary']));
    // Phần tuỳ chọn không bắt buộc.
    expect(js.required).not.toContain('assessment');
    expect(js.required).not.toContain('labels');
    expect(js.required).not.toContain('extensions');
    // Các khối kiểm tra hồ sơ tuỳ chọn; OCR (extractions) bắt buộc.
    for (const optional of ['parties', 'assets', 'documents', 'findings']) expect(js.required).not.toContain(optional);
    expect(js.required).toContain('extractions');
    expect(JSON.stringify(js)).not.toContain('evidence');
  });

  it('parseIntegrationIncludes: chỉ nhận giá trị đã biết, bỏ giá trị lạ (thêm include mới không phá consumer cũ)', () => {
    expect(parseIntegrationIncludes('narrative,labels')).toEqual(['narrative', 'labels']);
    expect(parseIntegrationIncludes(' LABELS , xyz ')).toEqual(['labels']);
    expect(parseIntegrationIncludes(null)).toEqual([]);
    expect(parseIntegrationIncludes('')).toEqual([]);
  });
});

describe('mã kết quả đóng của rule LLM / Agent', () => {
  it('3 rule LLM mặc định khai báo outputs.codes, có NOT_VERIFIABLE', () => {
    const llm = LOAN_CHECK_CATALOG.filter((c) => c.kind === 'PROMPT');
    expect(llm.length).toBe(3);
    for (const c of llm) expect(c.outputs?.codes).toContain('NOT_VERIFIABLE');
  });

  it('allowedCodes: dùng danh sách rule, thiếu thì dùng bộ mã chung', () => {
    expect(allowedCodes(['A_B'])).toEqual(['A_B']);
    expect(allowedCodes(undefined)).toEqual(DEFAULT_MODEL_CODES);
    expect(allowedCodes([])).toEqual(DEFAULT_MODEL_CODES);
  });

  it('resolveModelCode: chuẩn hoá, nhận mã hợp lệ, mã ngoài danh sách → UNKNOWN_CODE, vắng → không có', () => {
    expect(resolveModelCode('owner-match', ['OWNER_MATCH'])).toEqual({ code: 'OWNER_MATCH', unknown: false });
    expect(resolveModelCode('Owner match', ['OWNER_MATCH'])).toEqual({ code: 'OWNER_MATCH', unknown: false });
    expect(resolveModelCode('SOMETHING_ELSE', ['OWNER_MATCH'])).toEqual({ code: UNKNOWN_CODE, unknown: true });
    expect(resolveModelCode(undefined, ['OWNER_MATCH'])).toEqual({ unknown: false });
    expect(resolveModelCode('  ', ['OWNER_MATCH'])).toEqual({ unknown: false });
  });

  it('parseCheckSet: outputs.codes hợp lệ được giữ, sai bị bỏ kèm warning, rule engine không có outputs', () => {
    const good = parseCheckSet({ checks: [{ id: 'LOAN.CUSTOM.C1', prompt: 'p', outputs: { codes: ['OK_X', 'BAD_X', 'OK_X'] } }] });
    expect(good.checkSet.checks.find((c) => c.id === 'LOAN.CUSTOM.C1')?.outputs).toEqual({ codes: ['OK_X', 'BAD_X'] });
    const bad = parseCheckSet({ checks: [{ id: 'LOAN.CUSTOM.C2', prompt: 'p', outputs: { codes: ['không hợp lệ'] } }] });
    expect(bad.checkSet.checks.find((c) => c.id === 'LOAN.CUSTOM.C2')?.outputs).toBeUndefined();
    expect(bad.warnings.some((w) => w.includes('LOAN.CUSTOM.C2') && w.includes('outputs.codes'))).toBe(true);
    // Rule trong catalog giữ mã mặc định khi cấu hình không nêu.
    const kept = parseCheckSet({ checks: [{ id: 'LOAN.COLLATERAL.OWNER_MATCH' }] });
    expect(kept.checkSet.checks.find((c) => c.id === 'LOAN.COLLATERAL.OWNER_MATCH')?.outputs?.codes).toContain('OWNER_MATCH');
  });

  it('validateCheckSetValue: chặn outputs sai và outputs trên rule engine', () => {
    expect(validateCheckSetValue({ checks: [{ id: 'LOAN.CUSTOM.C1', name: 'x', kind: 'PROMPT', prompt: 'p', outputs: { codes: ['OK_X'] } }] })).toEqual({ ok: true });
    expect(validateCheckSetValue({ checks: [{ id: 'LOAN.CUSTOM.C1', name: 'x', kind: 'PROMPT', prompt: 'p', outputs: { codes: ['sai'] } }] })).toMatchObject({ ok: false });
    expect(validateCheckSetValue({ checks: [{ id: 'LOAN.CAPACITY.MIN_DSCR', outputs: { codes: ['OK_X'] } }] })).toMatchObject({ ok: false });
  });

  it('modelCheckJsonSchema: ép status/code/confidence ở dạng enum, dùng được làm response_format', () => {
    const js = JSON.stringify(modelCheckJsonSchema(['OWNER_MATCH', 'OWNER_DIFFERENT']));
    expect(js).toContain('OWNER_MATCH');
    expect(js).toContain('INSUFFICIENT_DATA');
  });
});

describe('parse đầu ra model bằng zod + mã đóng', () => {
  const record = (id: string): EvidenceRecord => ({
    evidence_id: id, field_path: 'field', value: 'A', normalized_value: 'A', file_name: 'x.pdf', doc_type_key: 'id_card', doc_type_label: 'x',
    classification_confidence: 0.9, extraction_method: 'AI_EXTRACT', evidence_kind: 'EXTRACTED_FIELD', review_status: 'ACCEPTED',
  });
  const evidence: EvidenceRegistry = { records: [record('ev-1')], by_file: [], by_document_type: [] };
  const check = DEFAULT_CHECK_SET.checks.find((c) => c.id === 'LOAN.COLLATERAL.OWNER_MATCH')!;
  const run = (entry: Record<string, unknown>) => parsePromptCheckResults({ results: [{ id: check.id, status: 'PASS', confidence: 0.95, reason: 'ok', evidence_ids: ['D1:field'], ...entry }] }, DEFAULT_CHECK_SET, evidence)
    .find((r) => r.rule_id === check.id)!;

  it('parseModelCheckOutput: bỏ phần tử sai hình dạng nhưng giữ phần tử đúng; nhận cả mảng trần', () => {
    const out = parseModelCheckOutput({ results: [{ id: 'a', status: 'PASS' }, 'rác', { status: 'PASS' }, 7] });
    expect(out.items.map((i) => i.id)).toEqual(['a']);
    expect(out.dropped).toBe(3);
    expect(parseModelCheckOutput([{ id: 'b', status: 'FAIL' }]).items).toHaveLength(1);
    expect(parseModelCheckOutput('không phải object')).toEqual({ items: [], dropped: 0 });
  });

  it('mã hợp lệ được ghi vào kết quả và đi vào CheckResult', () => {
    const r = run({ code: 'owner_match' });
    expect(r.result).toBe('PASS');
    expect(r.model_code).toBe('OWNER_MATCH');
    expect(toCheckResult(r, { modelCode: r.model_code }).outcome).toBe('PASS');
  });

  it('mã ngoài danh sách đã khai báo → hạ REVIEW với UNKNOWN_CODE, kể cả khi model nói PASS với độ tin cậy cao', () => {
    const r = run({ code: 'BỊA_RA' });
    expect(r.result).toBe('REVIEW');
    expect(r.reason_code).toBe('PROMPT_CHECK_UNKNOWN_CODE');
    expect(toCheckResult(r, { modelCode: r.model_code }).code).toBe(UNKNOWN_CODE);
  });

  it('không trả mã vẫn chạy bình thường (tương thích prompt cũ)', () => {
    const r = run({});
    expect(r.result).toBe('PASS');
    expect(r).not.toHaveProperty('model_code');
  });

  it('prompt liệt kê MÃ KẾT QUẢ của từng kiểm tra và yêu cầu không lặp tên/số định danh trong reason', () => {
    const prompt = String(buildPromptCheckVars({ checkSet: DEFAULT_CHECK_SET, evidence, customer360: {}, financial: {} as FinancialMetrics })._prompt);
    expect(prompt).toContain('MÃ KẾT QUẢ');
    expect(prompt).toContain('OWNER_MATCH | OWNER_DIFFERENT | NOT_VERIFIABLE');
    expect(prompt).toContain('không lặp lại họ tên hay số định danh');
  });
});
