// T-S1-08 — tóm tắt và key_facts theo danh mục cố định (S1-R19…R23, D-70).
import { ClassifyDataSchema } from '@/lib/loan-dossier/contracts/stage-result';
import { mergeSegments, type RawSegment } from '@/lib/loan-dossier/s1/batching';
import { buildClassifyPrompt, parseClassifierResponse } from '@/lib/loan-dossier/s1/classifier-port';
import { postprocess, type RawClassification } from '@/lib/loan-dossier/s1/postprocess';
import { runClassify, type ClassifyPorts } from '@/lib/loan-dossier/s1/run';

const fact = (subject: string, key: string, value: string | null, page: number | null = 1) => ({ subject, key, value, page });

function raw(over: Partial<RawClassification['matches'][number]> = {}): RawClassification {
  return {
    page_quality: 'OK',
    matches: [{
      doc_type_key: 'id_card', confidence: 0.95,
      instances: [{
        page_range: [1, 2], confidence: 0.95, starts_new_document: true,
        summary: 'Căn cước công dân của người vay.',
        key_facts: [fact('borrower', 'full_name', 'NGUYEN VAN A'), fact('borrower', 'id_number', '001090000001')],
      }],
      ...over,
    }],
  };
}

describe('parseClassifierResponse — summary / key_facts', () => {
  it('nhận summary và key_facts; thiếu thì mặc định rỗng (tương thích prompt cũ)', () => {
    const withFacts = parseClassifierResponse(raw());
    expect(withFacts.matches[0].instances[0].key_facts).toHaveLength(2);
    expect(withFacts.matches[0].instances[0].summary).toContain('Căn cước');
    const bare = parseClassifierResponse({
      page_quality: 'OK',
      matches: [{ doc_type_key: 'id_card', confidence: 0.9, instances: [{ page_range: [1, 2], confidence: 0.9 }] }],
    });
    expect(bare.matches[0].instances[0].summary).toBe('');
    expect(bare.matches[0].instances[0].key_facts).toEqual([]);
  });

  it('key_facts sai kiểu → JSON_PARSE_ERROR', () => {
    const bad = raw();
    (bad.matches[0].instances[0] as unknown as { key_facts: unknown }).key_facts = [{ subject: 1 }];
    expect(() => parseClassifierResponse(bad)).toThrow(/JSON_PARSE_ERROR/);
  });
});

describe('postprocess — S1-AC16, AC17, AC19', () => {
  it('S1-AC16: giữ key trong danh mục, value nguyên văn', () => {
    const inst = postprocess(raw(), null).matches[0].instances[0];
    expect(inst.key_facts.map((f) => f.key)).toEqual(['full_name', 'id_number']);
    expect(inst.key_facts[1].value).toBe('001090000001');
    expect(inst.summary).toBe('Căn cước công dân của người vay.');
  });

  it('S1-AC17: key ngoài danh mục bị bỏ; value không bị sửa (giữ cả lỗi OCR / khoảng trắng)', () => {
    const r = raw();
    r.matches[0].instances[0].key_facts = [
      fact('borrower', 'id_number', ' 0O1090000001 '),
      fact('borrower', 'date_of_birth', '01/01/1990'),
      fact('borrower', 'amount', '100.000.000'),
    ];
    const facts = postprocess(r, null).matches[0].instances[0].key_facts;
    expect(facts).toEqual([fact('borrower', 'id_number', ' 0O1090000001 ')]);
  });

  it('loại LIGHT không có danh mục: key_facts rỗng nhưng summary còn (S1-AC19)', () => {
    const r: RawClassification = {
      page_quality: 'OK',
      matches: [{ doc_type_key: 'household_business_license', confidence: 0.9, instances: [{ page_range: [1, 1], confidence: 0.9, summary: 'Giấy phép HKD.', key_facts: [fact('x', 'full_name', 'A')] }] }],
    };
    const inst = postprocess(r, null).matches[0].instances[0];
    expect(inst.key_facts).toEqual([]);
    expect(inst.summary).toBe('Giấy phép HKD.');
  });

  it('loan_application cho phép 7 key', () => {
    const keys = ['full_name', 'id_number', 'marital_status', 'amount', 'collateral_identifier', 'loan_purpose', 'income_source'];
    const r: RawClassification = {
      page_quality: 'OK',
      matches: [{ doc_type_key: 'loan_application', confidence: 0.9, instances: [{ page_range: [1, 3], confidence: 0.9, summary: 's', key_facts: keys.map((k) => fact('borrower', k, 'v')) }] }],
    };
    expect(postprocess(r, null).matches[0].instances[0].key_facts).toHaveLength(7);
  });

  it('kết quả vẫn qua ClassifyDataSchema (strict)', () => {
    const rec = postprocess(raw(), null);
    const data = {
      files: [{ file_id: 'file-3f9a1c2b7d10', file_name: 'a.pdf', status: rec.status, reason_code: rec.reason_code, next_action: rec.next_action, message: rec.message, page_count: 2, matches: rec.matches }],
      repeated_doc_types: [],
    };
    expect(ClassifyDataSchema.safeParse(data).success).toBe(true);
  });

  it('hợp đồng từ chối key_facts có key lạ trong instance', () => {
    const rec = postprocess(raw(), null);
    const bad = JSON.parse(JSON.stringify(rec.matches));
    bad[0].instances[0].extra = 1;
    const data = {
      files: [{ file_id: 'file-3f9a1c2b7d10', file_name: 'a.pdf', status: rec.status, reason_code: rec.reason_code, next_action: rec.next_action, message: rec.message, page_count: 2, matches: bad }],
      repeated_doc_types: [],
    };
    expect(ClassifyDataSchema.safeParse(data).success).toBe(false);
  });
});

describe('mergeSegments — S1-AC18', () => {
  const seg = (range: [number, number], facts: ReturnType<typeof fact>[], summary: string, starts: boolean): RawSegment => ({
    doc_type_key: 'land_use_certificate', page_range: range, confidence: 0.9, starts_new_document: starts, summary, key_facts: facts,
  });

  it('hợp nhất key_facts hai batch, khử trùng (subject,key,value), summary của batch đầu', () => {
    const a = seg([19, 20], [fact('asset-1', 'certificate_number', 'CN 6475', 19), fact('asset-1', 'full_name', 'A', 19)], 'GCN đầu', true);
    const b = seg([21, 22], [fact('asset-1', 'certificate_number', 'CN 6475', 21), fact('asset-1', 'id_number', '001090000001', 21)], 'GCN tiếp', false);
    const out = mergeSegments([[a], [b]]);
    expect(out).toHaveLength(1);
    expect(out[0].page_range).toEqual([19, 22]);
    expect(out[0].summary).toBe('GCN đầu');
    expect(out[0].key_facts.map((f) => `${f.key}=${f.value}`)).toEqual(['certificate_number=CN 6475', 'full_name=A', 'id_number=001090000001']);
  });

  it('cùng key nhưng value khác (lệch OCR) thì GIỮ CẢ HAI, không chọn bên nào', () => {
    const a = seg([19, 20], [fact('asset-1', 'certificate_number', 'CN 6475', 19)], 'x', true);
    const b = seg([21, 22], [fact('asset-1', 'certificate_number', 'CH.6475', 21)], 'y', false);
    const out = mergeSegments([[a], [b]]);
    expect(out[0].key_facts.map((f) => f.value)).toEqual(['CN 6475', 'CH.6475']);
  });
});

describe('buildClassifyPrompt — danh mục key_facts', () => {
  const p = buildClassifyPrompt([1, 4], 4);

  it('bỏ quy tắc cũ cấm trả tên / số giấy tờ', () => {
    expect(p).not.toContain('Không trả tên, số giấy tờ');
  });

  it('có quy tắc chép nguyên văn, không chuẩn hóa, null / "[không rõ]"', () => {
    expect(p).toContain('NGUYÊN VĂN');
    expect(p).toContain('[không rõ]');
    expect(p).toContain('không sửa lỗi');
  });

  it('danh mục key theo đúng từng loại FULL; LIGHT không có', () => {
    const line = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}: `))!;
    expect(line('id_card')).toContain('key_facts: full_name, id_number');
    expect(line('loan_application')).toContain('collateral_identifier');
    expect(line('loan_application')).toContain('income_source');
    expect(line('household_business_license')).not.toContain('key_facts');
    expect(p.match(/key_facts: /g)).toHaveLength(30);
  });

  it('ví dụ JSON có summary và key_facts; matches đứng trước phần tóm tắt', () => {
    const ex = p.split('\n').find((l) => l.startsWith('{"page_quality"'))!;
    expect(ex).toContain('"summary"');
    expect(ex).toContain('"key_facts"');
    expect(ex.indexOf('"page_range"')).toBeLessThan(ex.indexOf('"summary"'));
  });
});

describe('runClassify — không rò value ra log (S1-R23)', () => {
  it('luồng chạy không gọi console với value của key_facts', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const pdf = new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF'));
    const ports: ClassifyPorts = {
      readFile: async () => pdf,
      inspect: async () => ({ ok: true, page_count: 2 }),
      classifier: { classifyPages: async () => raw() },
    };
    const res = await runClassify([{ file_name: 'a.pdf', ref: 'r' }], ports);
    const inst = res.data!.files[0].matches[0].instances[0];
    expect(inst.key_facts.find((f) => f.key === 'id_number')?.value).toBe('001090000001');
    const logged = spies.flatMap((s) => s.mock.calls).flat().map(String).join(' ');
    expect(logged).not.toContain('001090000001');
    spies.forEach((s) => s.mockRestore());
  });
});
