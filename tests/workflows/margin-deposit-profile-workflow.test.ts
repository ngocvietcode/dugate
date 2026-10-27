import {
  parseClassifyDocuments,
  parseExtractFields,
  parseFrameworkCompareResult,
} from '@/lib/pipelines/workflows/margin-deposit-profile';

describe('margin-deposit AI response validation', () => {
  it('rejects malformed classifier output instead of silently dropping it', () => {
    expect(() => parseClassifyDocuments([{ code: 'cccd', page_range: '1', confidence: 2 }])).toThrow('INVALID_AI_RESPONSE');
    expect(() => parseClassifyDocuments([])).toThrow('INVALID_AI_RESPONSE');
  });

  it('still throws on a document-level failure (response not an object)', () => {
    // Document-level problems (not a JSON object / no schema) still fail hard —
    // there is nothing to return. Only per-field problems are isolated.
    expect(() => parseExtractFields('not json', 'don_tra_soat')).toThrow('extraction response must be an object');
  });

  it('isolates missing/invalid scalar fields into field_errors instead of failing the whole doc', () => {
    // An empty fields object: every configured field is missing → each is
    // recorded in field_errors with a safe empty value, nothing is thrown.
    const emptyResult = parseExtractFields({ fields: {} }, 'cccd');
    expect(Object.keys(emptyResult.field_errors).length).toBeGreaterThan(0);
    expect(emptyResult.field_errors.full_name).toMatch(/must be an object/);
    expect(emptyResult.fields.full_name).toEqual({ value: null, confidence: 0 });

    // A mix of good and bad fields: good ones are kept, only the bad one is flagged.
    const parsed = parseExtractFields({ fields: {
      full_name: { value: 'NGUYEN VAN AN', confidence: 0.9 },
      cccd_id: { value: '036192001506', confidence: 0.95 },
      date_of_birth: { value: '01/01/1990', confidence: 0.9 },
      nationality: { value: 'Việt Nam', confidence: 0.9 },
      id_issue_date: { value: '18/12/2021', confidence: 0.9 },
      id_place: { value: 'Cục CSQLHC', confidence: 0.9 },
      id_expiry_date: { value: 123, confidence: 0.9 }, // invalid: value must be string|null
    } }, 'cccd');
    expect(parsed.fields).toHaveProperty('full_name.value', 'NGUYEN VAN AN');
    expect(parsed.field_errors.id_expiry_date).toMatch(/value must be string or null/);
    expect(parsed.fields.id_expiry_date).toEqual({ value: null, confidence: 0 });
  });

  it('parses don_tra_soat as a nested array: reconciliation[] each with reconciliation_parties[]', () => {
    const parsed = parseExtractFields({ fields: {
      reconciliation: [
        {
          t24_transaction: { value: 'TT2616617478', confidence: 0.98 },
          amount: { value: '500.000.000', confidence: 0.98 },
          reconciliation_content: { value: 'Điều chỉnh ... NGUYEN VAN AN', confidence: 0.97 },
          reconciliation_parties: [
            { full_name: { value: 'NGUYEN VAN AN', confidence: 0.97 }, unit_code: { value: 'A2-05-02', confidence: 0.97 }, national_id: { value: '12345678910', confidence: 0.97 } },
            { full_name: { value: 'TRAN THI B', confidence: 0.96 }, unit_code: { value: 'A2-05-03', confidence: 0.96 }, national_id: { value: '98765432100', confidence: 0.96 } },
          ],
        },
      ],
    } }, 'don_tra_soat');
    expect(parsed.field_errors).toEqual({});
    const recon = parsed.fields.reconciliation as Array<Record<string, unknown>>;
    expect(Array.isArray(recon)).toBe(true);
    expect(recon).toHaveLength(1);
    expect((recon[0].t24_transaction as { value: string }).value).toBe('TT2616617478');
    const parties = recon[0].reconciliation_parties as Array<Record<string, { value: string | null }>>;
    expect(parties).toHaveLength(2);
    expect(parties[0].full_name.value).toBe('NGUYEN VAN AN');
    expect(parties[1].national_id.value).toBe('98765432100');
  });

  it('normalizes a single reconciliation record / single party object into one-element arrays', () => {
    // Model may return a lone record (object) and a lone party (object) instead
    // of arrays — both are wrapped since they look like real members.
    const parsed = parseExtractFields({ fields: {
      reconciliation: {
        t24_transaction: { value: 'TT1', confidence: 0.98 },
        amount: { value: '100.000', confidence: 0.98 },
        reconciliation_content: { value: 'x', confidence: 0.9 },
        reconciliation_parties: {
          full_name: { value: 'NGUYEN VAN AN', confidence: 0.97 },
          unit_code: { value: 'A1', confidence: 0.97 },
          national_id: { value: '123456789', confidence: 0.97 },
        },
      },
    } }, 'don_tra_soat');
    expect(parsed.field_errors).toEqual({});
    const recon = parsed.fields.reconciliation as Array<Record<string, unknown>>;
    expect(recon).toHaveLength(1);
    expect((recon[0].reconciliation_parties as unknown[]).length).toBe(1);
  });

  it('parses array fields (escrow_parties, installments) as arrays of {value, confidence} members', () => {
    const parsed = parseExtractFields({ fields: {
      escrow_parties: [
        {
          code: { value: '1', confidence: 0.99 },
          escrow_full_name: { value: 'NGUYỄN VĂN AN', confidence: 0.99 },
          escrow_national_id: { value: '036192001506', confidence: 0.99 },
          escrow_id_issue_date: { value: '19/01/2024', confidence: 0.99 },
        },
      ],
      unit_code: { value: 'A1-16.21', confidence: 0.95 },
      total_escrow_amount: { value: '478000000', confidence: 0.99 },
      number_of_installments: { value: '2', confidence: 0.99 },
      installments: [
        { installment_index: { value: '1', confidence: 0.99 }, amount: { value: '239000000', confidence: 0.99 } },
        { installment_index: { value: '2', confidence: 0.99 }, amount: { value: '239000000', confidence: 0.99 } },
      ],
    } }, 'thoa_thuan_ky_quy');
    expect(parsed.field_errors).toEqual({});
    expect(Array.isArray(parsed.fields.escrow_parties)).toBe(true);
    expect((parsed.fields.escrow_parties as Array<Record<string, { value: string | null }>>)[0].escrow_full_name.value).toBe('NGUYỄN VĂN AN');
    expect((parsed.fields.installments as unknown[]).length).toBe(2);
  });

  it('normalizes a single member object into a one-element array (no AI retry)', () => {
    // Models often return a lone group member as an object instead of a 1-item
    // array. We wrap it when it looks like a real member, then validate it as
    // usual — the output contract (array of members) is unchanged.
    const parsed = parseExtractFields({ fields: {
      unit_code: { value: 'A1-16.21', confidence: 0.95 },
      escrow_parties: {
        code: { value: '1', confidence: 0.99 },
        escrow_full_name: { value: 'NGUYỄN VĂN AN', confidence: 0.99 },
        escrow_national_id: { value: '036192001506', confidence: 0.99 },
        escrow_id_issue_date: { value: '19/01/2024', confidence: 0.99 },
      },
    } }, 'dang_ky_nguyen_vong');
    expect(parsed.field_errors).toEqual({});
    expect(Array.isArray(parsed.fields.escrow_parties)).toBe(true);
    expect((parsed.fields.escrow_parties as unknown[]).length).toBe(1);
    expect((parsed.fields.escrow_parties as Array<Record<string, { value: string | null }>>)[0].escrow_full_name.value).toBe('NGUYỄN VĂN AN');
  });

  it('isolates a non-array member-less value into field_errors (empty array placeholder kept)', () => {
    // A scalar-ish object with none of the member keys must NOT be wrapped — it
    // is flagged in field_errors and left as an empty array so downstream array
    // readers stay type-correct, while other fields survive.
    const parsed = parseExtractFields({ fields: {
      unit_code: { value: 'A', confidence: 0.9 },
      escrow_parties: { foo: { value: '1', confidence: 0.9 } },
    } }, 'dang_ky_nguyen_vong');
    expect(parsed.fields).toHaveProperty('unit_code.value', 'A');
    expect(parsed.field_errors.escrow_parties).toMatch(/must be an array/);
    expect(parsed.fields.escrow_parties).toEqual([]);
  });

  it('isolates a wrapped single member missing required sub-fields into field_errors', () => {
    // Wrapping does not fabricate data: a member object missing required keys
    // still fails validation, but only that field is flagged.
    const parsed = parseExtractFields({ fields: {
      unit_code: { value: 'A', confidence: 0.9 },
      escrow_parties: { code: { value: '1', confidence: 0.9 } },
    } }, 'dang_ky_nguyen_vong');
    expect(parsed.fields).toHaveProperty('unit_code.value', 'A');
    expect(parsed.field_errors.escrow_parties).toMatch(/must be an object \{ value, confidence \}/);
    expect(parsed.fields.escrow_parties).toEqual([]);
  });

  it('rejects malformed framework verdicts and clause arrays', () => {
    expect(() => parseFrameworkCompareResult({ verdict: 'OK', clauses_modified: [] })).toThrow('INVALID_AI_RESPONSE');
    expect(() => parseFrameworkCompareResult({ verdict: 'PASS' })).toThrow('INVALID_AI_RESPONSE');
    expect(parseFrameworkCompareResult({ verdict: 'PASS', clauses_modified: [] }).verdict).toBe('PASS');
  });

  it('forces FAIL with DOC_TYPE_MISMATCH when the comparator reports different document types', () => {
    const result = parseFrameworkCompareResult({
      document_type_match: false,
      customer_doc_title: 'THỎA THUẬN KÝ QUỸ',
      template_doc_title: 'BIÊN BẢN THANH LÝ',
      verdict: 'PASS',
      clauses_modified: [{ clause_id: '1', action: 'modified', severity: 'info' }],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.error).toContain('DOC_TYPE_MISMATCH');
    expect(result.error).toContain('THỎA THUẬN KÝ QUỸ');
    expect(result.error).toContain('BIÊN BẢN THANH LÝ');
    expect(result.clauses_modified).toEqual([]);
  });

  it('still compares clause-by-clause when document types match', () => {
    const result = parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'PASS',
      clauses_modified: [],
    });
    expect(result.verdict).toBe('PASS');
    expect(result.error).toBeUndefined();
  });

  it('captures matched_template when the comparator chose a template (multi-template OR)', () => {
    const pass = parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'PASS',
      matched_template: 'Đơn tra soát - Mẫu 2',
      clauses_modified: [],
    });
    expect(pass.verdict).toBe('PASS');
    expect(pass.matched_template).toBe('Đơn tra soát - Mẫu 2');

    // When no template matches, FAIL still reports the nearest template.
    const fail = parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'FAIL',
      matched_template: 'Đơn tra soát - Mẫu 1',
      clauses_modified: [{ clause_id: 'Tiêu đề', action: 'modified', severity: 'critical' }],
    });
    expect(fail.verdict).toBe('FAIL');
    expect(fail.matched_template).toBe('Đơn tra soát - Mẫu 1');
  });

  it('omits matched_template when the comparator did not supply one', () => {
    const result = parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'PASS',
      clauses_modified: [],
    });
    expect(result.matched_template).toBeUndefined();
  });

  it('accepts the "missing" action with a per-location detail message', () => {
    const result = parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'FAIL',
      clauses_modified: [
        {
          clause_id: 'Điều 3 - Số tiền ký quỹ',
          action: 'missing',
          template: 'Số tiền ký quỹ: 478.000.000 VND',
          detail: 'Khách hàng thiếu hoàn toàn mục "Điều 3 - Số tiền ký quỹ" có trong khung.',
          severity: 'critical',
        },
        {
          clause_id: 'Căn cứ',
          action: 'modified',
          template: 'Bộ luật Dân sự 2015',
          customer: 'Bộ luật Dân sự 2005',
          detail: 'Năm bộ luật lệch: khung ghi 2015, khách hàng ghi 2005.',
          severity: 'warning',
        },
      ],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.clauses_modified).toHaveLength(2);
    expect(result.clauses_modified[0].action).toBe('missing');
    expect(result.clauses_modified[0].template).toContain('478.000.000');
    expect(result.clauses_modified[0].detail).toContain('thiếu');
    expect(result.clauses_modified[1].template).toBe('Bộ luật Dân sự 2015');
    expect(result.clauses_modified[1].customer).toBe('Bộ luật Dân sự 2005');
    expect(result.clauses_modified[1].detail).toContain('2015');
  });

  it('rejects a clause whose detail is not a string', () => {
    expect(() => parseFrameworkCompareResult({
      document_type_match: true,
      verdict: 'FAIL',
      clauses_modified: [{ clause_id: 'X', action: 'missing', detail: 123, severity: 'critical' }],
    })).toThrow('INVALID_AI_RESPONSE');
  });
});


