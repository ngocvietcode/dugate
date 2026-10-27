// T-V2-12 — bước kiểm tra sơ bộ bằng LLM ngay sau S1 (V2-R16…R20). Dữ liệu giả, không có PII thật.
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';
import { loadChecklistPrograms, resolveChecklist } from '@/lib/loan-dossier/s4/programs';
import {
  buildPrecheckContext, DOSSIER_PRECHECK_PROMPT_TEMPLATE, DOSSIER_PRECHECK_STEP, guardPrecheck, isPrecheckEnabled, runDossierPrecheck,
  summarizePrecheck, type PrecheckInput,
} from '@/lib/pipelines/workflows/loan-appraisal/dossier-precheck';

interface DocSpec { id: string; type: string; facts?: Array<[string, string, string | null]>; summary?: string }

function classify(docs: DocSpec[], extra: ClassifyData['files'] = []): ClassifyData {
  return {
    files: [
      ...docs.map((d) => ({
        file_id: d.id, file_name: `ten-file-nhay-cam-${d.id}.pdf`, status: 'CLASSIFIED' as const, reason_code: null, next_action: null, message: null, page_count: 1,
        matches: [{
          doc_type_key: d.type, confidence: 0.92, needs_manual_review: false, needs_extraction: docTypeByKey(d.type)!.needs_extraction,
          instances_count: 1, hint_mismatch: false,
          instances: [{
            instance_index: 1, page_range: [1, 1] as [number, number], confidence: 0.92, summary: d.summary ?? 'Tóm tắt giả.',
            key_facts: (d.facts ?? []).map(([subject, key, value]) => ({ subject, key, value, page: 1 })),
          }],
        }],
      })),
      ...extra,
    ],
    repeated_doc_types: [],
  };
}

const BASE: DocSpec[] = [
  { id: 'file-aaaaaaaa0001', type: 'loan_application', facts: [['NGUYEN VAN A', 'full_name', 'NGUYEN VAN A'], ['NGUYEN VAN A', 'amount', '500.000.000']] },
  { id: 'file-aaaaaaaa0002', type: 'id_card', facts: [['NGUYEN VAN A', 'id_number', '000000000000']] },
  { id: 'file-aaaaaaaa0003', type: 'cic' },
];
const input = (docs: DocSpec[] = BASE, extra: Partial<PrecheckInput> = {}): PrecheckInput => ({ classify: classify(docs), product_code: 'hkd-loan', flow: 'FULL', ...extra });

const program = loadChecklistPrograms().programs[0];
const requiredKeys = resolveChecklist(program, 'FULL').rows.filter((r) => r.requirement === 'REQUIRED').map((r) => r.item.item_key);

function ctxOf(i: PrecheckInput = input()) {
  const c = buildPrecheckContext(i);
  if ('skip' in c) throw new Error(c.skip);
  return c;
}

/** LLM giả: PROVIDED cho mọi mục REQUIRED mà có chứng từ chấp nhận trong BASE, còn lại MISSING. */
function goodAnswer() {
  const c = ctxOf();
  const byType = new Map([...c.docs.values()].map((d) => [d.doc_type_key, d.doc_ref]));
  const checklist = [...c.rows.values()].filter((r) => r.requirement === 'REQUIRED').map((r) => {
    const type = [...r.accepted].find((t) => byType.has(t));
    return type
      ? { item_key: r.item.item_key, subject: r.item.scope === 'PERSON' ? 'NGUYEN VAN A' : null, status: 'PROVIDED', doc_refs: [byType.get(type)!], note: null }
      : { item_key: r.item.item_key, subject: null, status: 'MISSING', doc_refs: [], note: 'Chưa có chứng từ.' };
  });
  return { checklist, relations: [{ topic: 'Người vay', status: 'CONSISTENT', doc_refs: [...byType.values()].slice(0, 2), message: 'Cùng người vay.' }], overview: 'Hồ sơ vay của NGUYEN VAN A.', next_actions: ['Bổ sung chứng từ còn thiếu'] };
}

describe('buildPrecheckContext', () => {
  it('dựng checklist REQUIRED/CONDITIONAL của luồng và danh sách chứng từ có mã D..', () => {
    const c = ctxOf();
    for (const k of requiredKeys) expect(c.rows.get(k)?.requirement).toBe('REQUIRED');
    expect([...c.docs.keys()]).toEqual(['D01', 'D02', 'D03']);
    expect(c.rows.has('collateral_cic_check')).toBe(false); // mục không chấm theo chứng từ
  });

  it('mục thay thế được tính vào loại chứng từ chấp nhận (legal_vneid ↔ residence_confirmation)', () => {
    expect(ctxOf().rows.get('legal_vneid')!.accepted).toEqual(new Set(['vneid', 'residence_confirmation']));
  });

  it('không có chương trình / không có chứng từ phân loại được → skip', () => {
    expect(buildPrecheckContext({ ...input(), product_code: 'khong-co' })).toHaveProperty('skip');
    const none = { classify: { files: [{ file_id: 'file-zzzzzzzz0001', file_name: 'x', status: 'UNKNOWN' as const, reason_code: 'UNCLASSIFIED', next_action: null, message: null, page_count: 1, matches: [] }], repeated_doc_types: [] }, product_code: 'hkd-loan', flow: 'FULL' };
    expect(buildPrecheckContext(none)).toHaveProperty('skip');
  });

  it('ghi đè Profile: tắt một mục REQUIRED thì mục đó không còn trong checklist gửi LLM', () => {
    const c = ctxOf(input(BASE, { checklist_overrides: { [program.program_key]: { legal_id_card: { FULL: null } } } }));
    expect(c.rows.has('legal_id_card')).toBe(false);
  });
});

describe('runDossierPrecheck', () => {
  it('prompt: có checklist + summary/key_facts, không có tên file, có UNTRUSTED_DATA_GUARD', async () => {
    const ask = jest.fn().mockResolvedValue(goodAnswer());
    await runDossierPrecheck(input(), ask, {});
    const prompt = String(ask.mock.calls[0][0]);
    expect(prompt).toContain('[AN TOÀN DỮ LIỆU]');
    expect(prompt).toContain('<untrusted_checklist>');
    expect(prompt).toContain('<untrusted_documents>');
    expect(prompt).toContain('legal_id_card');
    expect(prompt).toContain('NGUYEN VAN A');
    expect(prompt).not.toContain('ten-file-nhay-cam');
    expect(prompt).not.toContain('file-aaaaaaaa0001'); // LLM chỉ thấy mã D.., không thấy file_id
  });

  it('phản hồi hợp lệ → COMPLETED, đếm theo trạng thái, overall do code tính', async () => {
    const out = await runDossierPrecheck(input(), jest.fn().mockResolvedValue(goodAnswer()), {});
    expect(out).toMatchObject({ status: 'COMPLETED', source: 'LLM', draft: true, flow: 'FULL', program_key: program.program_key, warning: null });
    expect(out.by_status.PROVIDED).toBeGreaterThan(0);
    expect(out.by_status.MISSING).toBeGreaterThan(0); // thiếu các mục REQUIRED khác (hợp đồng/đề xuất...)
    expect(out.overall).toBe('GAPS_FOUND');
    const idLine = out.checklist.find((l) => l.item_key === 'legal_id_card')!;
    expect(idLine).toMatchObject({ status: 'PROVIDED', adjusted: false });
    expect(idLine.evidence).toEqual([{ doc_ref: 'D02', file_id: 'file-aaaaaaaa0002', doc_type_key: 'id_card', instance_index: 1 }]);
    expect(out.by_group.reduce((s, g) => s + g.total, 0)).toBe(out.checklist.length);
  });

  it('LLM lỗi → UNAVAILABLE, không có overall, không báo đủ hồ sơ', async () => {
    const out = await runDossierPrecheck(input(), jest.fn().mockRejectedValue(new Error('timeout')), {});
    expect(out).toMatchObject({ status: 'UNAVAILABLE', source: 'NONE', overall: null, checklist: [] });
    expect(out.warning).toContain('timeout');
  });

  it('phản hồi sai schema → UNAVAILABLE', async () => {
    const out = await runDossierPrecheck(input(), jest.fn().mockResolvedValue({ checklist: 'x' }), {});
    expect(out).toMatchObject({ status: 'UNAVAILABLE', overall: null });
    const text = await runDossierPrecheck(input(), jest.fn().mockResolvedValue('không phải JSON'), {});
    expect(text.status).toBe('UNAVAILABLE');
  });

  it('lỗi huỷ được ném lại; lỗi thường thì không', async () => {
    class Cancelled extends Error {}
    await expect(runDossierPrecheck(input(), jest.fn().mockRejectedValue(new Cancelled()), {}, (e) => e instanceof Cancelled)).rejects.toBeInstanceOf(Cancelled);
  });

  it('không có chương trình → SKIPPED và không gọi LLM', async () => {
    const ask = jest.fn();
    const out = await runDossierPrecheck({ ...input(), product_code: 'khong-co' }, ask, {});
    expect(out).toMatchObject({ status: 'SKIPPED', overall: null });
    expect(ask).not.toHaveBeenCalled();
  });

  it('prompt ghi đè được dùng; thiếu placeholder thì hệ thống nối thêm dữ liệu', async () => {
    const ask = jest.fn().mockResolvedValue(goodAnswer());
    const out = await runDossierPrecheck(input(), ask, { [DOSSIER_PRECHECK_STEP]: 'PROMPT RIÊNG. {{output_schema}}' });
    const prompt = String(ask.mock.calls[0][0]);
    expect(prompt).toContain('PROMPT RIÊNG.');
    expect(prompt).toContain('legal_id_card');
    expect(prompt).toContain('NGUYEN VAN A');
    expect(out.prompt_overridden).toBe(true);
    expect(DOSSIER_PRECHECK_PROMPT_TEMPLATE).toContain('{{checklist}}');
  });

  it('không console.* nào chứa key_facts', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    await runDossierPrecheck(input(), jest.fn().mockResolvedValue(goodAnswer()), {});
    await runDossierPrecheck(input(), jest.fn().mockRejectedValue(new Error('x')), {});
    for (const s of spies) { expect(JSON.stringify(s.mock.calls)).not.toContain('500.000.000'); s.mockRestore(); }
  });
});

describe('guardPrecheck — rào chắn hình thức (V2-R19)', () => {
  const raw = (checklist: unknown[], relations: unknown[] = []) => ({ checklist, relations, overview: 'x', next_actions: [] }) as never;

  it('mục lạ bị bỏ; trùng (item, subject) giữ dòng đầu', () => {
    const g = guardPrecheck(ctxOf(), raw([
      { item_key: 'khong_co_muc_nay', subject: null, status: 'PROVIDED', doc_refs: ['D01'] },
      { item_key: 'legal_id_card', subject: 'A', status: 'PROVIDED', doc_refs: ['D02'] },
      { item_key: 'legal_id_card', subject: 'a', status: 'MISSING', doc_refs: [] },
    ]));
    expect(g.checklist.some((l) => l.item_key === 'khong_co_muc_nay')).toBe(false);
    expect(g.checklist.filter((l) => l.item_key === 'legal_id_card' && l.subject)).toHaveLength(1);
    expect(g.checklist.find((l) => l.item_key === 'legal_id_card' && l.subject)!.status).toBe('PROVIDED');
  });

  it('PROVIDED với căn cứ không tồn tại / sai loại chứng từ → hạ UNCERTAIN, adjusted', () => {
    const g = guardPrecheck(ctxOf(), raw([
      { item_key: 'legal_id_card', subject: 'A', status: 'PROVIDED', doc_refs: ['D99'] },
      { item_key: 'credit_cic_report', subject: null, status: 'PROVIDED', doc_refs: ['D01'] }, // D01 là loan_application, không phải cic
      { item_key: 'loan_plan_loan_application', subject: null, status: 'PROVIDED', doc_refs: [] },
    ]));
    for (const k of ['legal_id_card', 'credit_cic_report', 'loan_plan_loan_application']) {
      expect(g.checklist.find((l) => l.item_key === k && (l.subject !== null || k !== 'legal_id_card'))).toMatchObject({ status: 'UNCERTAIN', adjusted: true, evidence: [] });
    }
  });

  it('chấp nhận căn cứ thuộc mục thay thế', () => {
    const c = ctxOf(input([...BASE, { id: 'file-aaaaaaaa0004', type: 'vneid' }]));
    const ref = [...c.docs.values()].find((d) => d.doc_type_key === 'vneid')!.doc_ref;
    const g = guardPrecheck(c, raw([{ item_key: 'legal_residence_confirmation', subject: 'A', status: 'PROVIDED', doc_refs: [ref] }]));
    expect(g.checklist.find((l) => l.item_key === 'legal_residence_confirmation' && l.subject)).toMatchObject({ status: 'PROVIDED', adjusted: false });
  });

  it('NOT_APPLICABLE cho mục REQUIRED → UNCERTAIN; cho mục CONDITIONAL được giữ', () => {
    const g = guardPrecheck(ctxOf(), raw([
      { item_key: 'legal_id_card', subject: 'A', status: 'NOT_APPLICABLE', doc_refs: [] },
      { item_key: 'legal_marriage_certificate', subject: 'A', status: 'NOT_APPLICABLE', doc_refs: [] },
    ]));
    expect(g.checklist.find((l) => l.item_key === 'legal_id_card' && l.subject)).toMatchObject({ status: 'UNCERTAIN', adjusted: true });
    expect(g.checklist.find((l) => l.item_key === 'legal_marriage_certificate' && l.subject)).toMatchObject({ status: 'NOT_APPLICABLE', adjusted: false });
  });

  it('mục REQUIRED bị bỏ sót → thêm dòng UNCERTAIN, adjusted', () => {
    const g = guardPrecheck(ctxOf(), raw([]));
    for (const k of requiredKeys) expect(g.checklist.find((l) => l.item_key === k)).toMatchObject({ status: 'UNCERTAIN', adjusted: true });
  });

  it('INCONSISTENT không còn căn cứ → UNCLEAR; ref lạ bị lọc', () => {
    const g = guardPrecheck(ctxOf(), raw([], [
      { topic: 'Số tiền', status: 'INCONSISTENT', doc_refs: ['D77'], message: 'x' },
      { topic: 'Tên', status: 'INCONSISTENT', doc_refs: ['d01', 'D77'], message: 'y' },
    ]));
    expect(g.relations[0]).toMatchObject({ status: 'UNCLEAR', evidence: [] });
    expect(g.relations[1]).toMatchObject({ status: 'INCONSISTENT' });
    expect(g.relations[1].evidence.map((e) => e.doc_ref)).toEqual(['D01']);
  });
});

describe('summarizePrecheck', () => {
  it('overall: không có MISSING / REQUIRED chưa rõ / INCONSISTENT → NO_GAPS_FOUND; có → GAPS_FOUND', () => {
    const line = (status: 'PROVIDED' | 'MISSING' | 'UNCERTAIN' | 'NOT_APPLICABLE', requirement: 'REQUIRED' | 'CONDITIONAL') => ({
      item_key: 'k', label: 'k', group: 'legal', group_label: 'I', requirement, subject: null, status, evidence: [], note: null, adjusted: false,
    });
    expect(summarizePrecheck([line('PROVIDED', 'REQUIRED'), line('NOT_APPLICABLE', 'CONDITIONAL')], []).overall).toBe('NO_GAPS_FOUND');
    expect(summarizePrecheck([line('UNCERTAIN', 'CONDITIONAL')], []).overall).toBe('NO_GAPS_FOUND');
    expect(summarizePrecheck([line('UNCERTAIN', 'REQUIRED')], []).overall).toBe('GAPS_FOUND');
    expect(summarizePrecheck([line('MISSING', 'CONDITIONAL')], []).overall).toBe('GAPS_FOUND');
    expect(summarizePrecheck([line('PROVIDED', 'REQUIRED')], [{ topic: 't', status: 'INCONSISTENT', evidence: [], message: 'm' }]).overall).toBe('GAPS_FOUND');
  });
});

describe('isPrecheckEnabled', () => {
  it('mặc định bật; tắt khi false/"false"/"0"/"no"', () => {
    for (const v of [undefined, null, '', true, 'true', '1']) expect(isPrecheckEnabled(v)).toBe(true);
    for (const v of [false, 'false', ' FALSE ', '0', 'no']) expect(isPrecheckEnabled(v)).toBe(false);
  });
});
