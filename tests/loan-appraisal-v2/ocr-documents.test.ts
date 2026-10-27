// T-V2-09 — hiển thị kết quả hồ sơ theo cấu trúc spec-v3 (V2-R10).
import { assetContextView, checklistGroups, crossCheckFilter, crossCheckSourceText, evidenceFields, formatVnd, groupCrossCheckValues, hiddenChecklistCount, labelOf } from '@/app/loan-appraisal-v2/lib/dossier-view';
import type { DossierEvidence, DossierOutputV3 } from '@/app/loan-appraisal/types';

const env = (data: Record<string, unknown>): DossierEvidence => ({
  evidence_id: 'ev-aaaaaaaaaaaa', extraction_level: 'FULL', file_id: 'file-aaaaaaaaaaaa', file_name: 'a.pdf', doc_type_key: 'loan_application',
  doc_type_label: 'Giấy đề nghị vay vốn', instance_index: 1, page_range: [1, 3], status: 'SUCCESS', reason_code: null, message: null,
  detected_form_name: null, form_variant: null, schema_version: '3.0.0', data, field_confidences: { parties: 0.95, loan_info: 0.6 },
  source_pages: { parties: [1], loan_info: [2] }, duplicate_group_id: null, duplicate_status: null, differing_fields: [],
});

describe('dossier-view', () => {
  const data = {
    parties: [{ party_index: 0, full_name: 'NGUYỄN VĂN AN', permanent_address: { full_text: 'Số 1, Phường A, Hà Nội', street: null, ward: null, district: null, province: null }, id_number: null }],
    assets: [{ asset_index: 0, identifiers: { license_plate: '51K-123.45', chassis_number: null } }],
    fields: { business_line: 'Tạp hóa' },
    loan_info: { bank_proposed_amount: 500000000, bank_proposed_amount_page: 3, loan_term_months: 60 },
  };
  const rows = evidenceFields(env(data));
  const byPath = (p: string) => rows.find((r) => r.path === p);

  it('lá parties[0].full_name, assets[0].identifiers.license_plate, fields.business_line có nhãn và giá trị', () => {
    expect(byPath('parties[0].full_name')).toMatchObject({ label: 'Người/tổ chức #1 · Họ và tên', value: 'NGUYỄN VĂN AN', confidence: 0.95, pages: [1] });
    expect(byPath('assets[0].identifiers.license_plate')?.value).toBe('51K-123.45');
    expect(byPath('fields.business_line')).toMatchObject({ label: 'Thông tin · Ngành nghề', value: 'Tạp hóa' });
  });

  it('địa chỉ object hiện full_text; null và field kỹ thuật bị bỏ', () => {
    expect(byPath('parties[0].permanent_address')?.value).toBe('Số 1, Phường A, Hà Nội');
    expect(byPath('parties[0].id_number')).toBeUndefined();
    expect(byPath('parties[0].party_index')).toBeUndefined();
    expect(byPath('loan_info.bank_proposed_amount_page')).toBeUndefined();
  });

  it('tiền số nguyên hiển thị định dạng VND; số khác giữ số', () => {
    expect(byPath('loan_info.bank_proposed_amount')?.value).toBe(formatVnd(500000000));
    expect(formatVnd(500000000)).toMatch(/500.000.000 ₫/);
    expect(byPath('loan_info.loan_term_months')?.value).toBe('60');
    expect(labelOf('loan_info.bank_proposed_amount')).toBe('Khoản vay · Số tiền cho vay');
  });

  it('D-65: checklist bỏ mục "Không áp dụng" (ngoài luồng / điều kiện không thỏa); mục không bắt buộc mà có chứng từ vẫn hiện', () => {
    const items = [
      { checklist_group: 'legal', status: 'PRESENT', required: true },
      { checklist_group: 'legal', status: 'NOT_APPLICABLE', required: false },
      { checklist_group: 'legal', status: 'PRESENT', required: false },
      { checklist_group: 'collateral', status: 'NOT_APPLICABLE', required: false },
      { checklist_group: 'collateral', status: 'MISSING', required: true },
    ];
    const checklist = { items, summary_by_group: [] } as unknown as DossierOutputV3['checklist'];
    expect(checklistGroups(checklist).map((g) => [g.group, g.items.map((i) => i.status)])).toEqual([
      ['legal', ['PRESENT', 'PRESENT']], ['loan_plan', []], ['income_source', []], ['collateral', ['MISSING']], ['credit_relationship', []],
    ]);
    expect(hiddenChecklistCount(checklist)).toBe(2);
  });

  it('checklist theo 5 nhóm I→V; lọc đối chiếu mặc định = MISMATCH + UNDETERMINED', () => {
    const checklist = { items: [{ checklist_group: 'collateral' }, { checklist_group: 'legal' }], summary_by_group: [] } as unknown as DossierOutputV3['checklist'];
    expect(checklistGroups(checklist).map((g) => [g.group, g.items.length])).toEqual([['legal', 1], ['loan_plan', 0], ['income_source', 0], ['collateral', 1], ['credit_relationship', 0]]);
    const results = [{ match_status: 'MATCH' }, { match_status: 'MISMATCH' }, { match_status: 'UNDETERMINED' }] as never;
    expect(crossCheckFilter(results, 'MISMATCH')).toHaveLength(2);
    expect(crossCheckFilter(results, 'MATCH')).toHaveLength(1);
    expect(crossCheckFilter(results, 'ALL')).toHaveLength(3);
  });

  it('gom nguồn cùng giá trị (theo normalized_value) thành 1 dòng, giữ thứ tự, bỏ nguồn lặp cùng file + trang', () => {
    const v = (value: string, normalized: string, file_name: string, page: number) => ({ value, normalized_value: normalized, id_status: null, source: { file_name, page } });
    const values = [
      v('NGUYỄN THỊ B', 'NGUYỄN THỊ B', 'a.pdf', 1),
      v('Nguyễn Thị B', 'NGUYỄN THỊ B', 'b.pdf', 5),
      v('NGUYEN THI B', 'NGUYEN THI B', 'cic.pdf', 1),
      v('NGUYỄN THỊ B', 'NGUYỄN THỊ B', 'a.pdf', 1),
    ] as never;
    expect(groupCrossCheckValues(values).map((g) => [g.value, g.sources.map((s) => `${s.file_name}:${s.page}`)])).toEqual([
      ['NGUYỄN THỊ B', ['a.pdf:1', 'b.pdf:5']],
      ['NGUYEN THI B', ['cic.pdf:1']],
    ]);
  });
  it('D-43: nguồn ghi mẫu biểu trước file; cùng file cùng trang nhưng khác mẫu biểu là 2 nguồn', () => {
    const v = (value: string, evidence_id: string, file_name: string, page: number) => ({ value, normalized_value: value, id_status: null, source: { evidence_id, file_name, page } });
    const evs = [
      { evidence_id: 'ev-g', doc_type_label: 'GCN QSDĐ' },
      { evidence_id: 'ev-v', doc_type_label: 'Chứng thư thẩm định giá' },
    ];
    const groups = groupCrossCheckValues([v('CH.6475', 'ev-g', 'dinh_gia_doi_chieu.pdf', 24), v('CH.6475', 'ev-v', 'dinh_gia_doi_chieu.pdf', 24), v('CH.6475', 'ev-x', 'x.pdf', 1)] as never, evs);
    expect(groups[0].sources.map(crossCheckSourceText)).toEqual([
      'GCN QSDĐ (dinh_gia_doi_chieu.pdf · tr.24)',
      'Chứng thư thẩm định giá (dinh_gia_doi_chieu.pdf · tr.24)',
      'x.pdf · tr.1',
    ]);
  });
  it('assetContextView: tách chưa rõ mục đích / TSBĐ cần xác nhận (định danh lệch, ghép yếu) / đã xác nhận', () => {
    const base = { asset_id: 'asset-1', asset_type: 'real_estate', identifiers: {}, owner_person_ids: [], current_owner_person_ids: [], identifier_conflicts: [], sources: [{ evidence_id: 'ev-1', doc_type_key: 'loan_application' }] };
    const evs = [{ evidence_id: 'ev-1', file_name: 'de_nghi_vay_von.pdf', doc_type_label: 'Giấy đề nghị vay vốn' }] as never;
    const view = (o: object) => assetContextView({ ...base, ...o } as never, evs);
    expect(view({ usage_contexts: [], context_status: 'UNRESOLVED', context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS' }).label).toBe('Chưa rõ mục đích');
    const conflict = view({ usage_contexts: ['collateral'], context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_IDENTIFIER_CONFLICT',
      identifier_conflicts: [{ field: 'certificate_book_number', values: ['CN 6475', 'CS 06475'], evidence_ids: ['ev-1'] }] });
    expect(conflict).toMatchObject({ label: 'TSBĐ · cần xác nhận', conflicts: ['Số vào sổ: CN 6475 ≠ CS 06475 (de_nghi_vay_von.pdf)'], sources: ['de_nghi_vay_von.pdf (Giấy đề nghị vay vốn)'] });
    expect(view({ usage_contexts: ['collateral'], context_status: 'AMBIGUOUS', context_reason_code: 'ASSET_CONTEXT_AMBIGUOUS' }).reason).toContain('ghép gần đúng');
    expect(view({ usage_contexts: ['collateral'], context_status: 'CONFIRMED', context_reason_code: null })).toMatchObject({ label: 'TSBĐ', tone: 'success', reason: null });
  });
  it('D-41: "Cần xem" gồm cả Gần khớp nhưng xếp sau lệch thật; lọc riêng Gần khớp; tài sản CONFIRMED có định danh nghi lỗi đọc', () => {
    const results = [{ match_status: 'NEAR_MATCH', result_id: 'a' }, { match_status: 'MATCH', result_id: 'b' }, { match_status: 'MISMATCH', result_id: 'c' }] as never;
    expect(crossCheckFilter(results, 'MISMATCH').map((r) => r.result_id)).toEqual(['c', 'a']);
    expect(crossCheckFilter(results, 'NEAR_MATCH').map((r) => r.result_id)).toEqual(['a']);
    const asset = { asset_id: 'asset-1', asset_type: 'real_estate', identifiers: {}, owner_person_ids: [], current_owner_person_ids: [], sources: [],
      usage_contexts: ['collateral'], context_status: 'CONFIRMED', context_reason_code: null,
      identifier_conflicts: [{ field: 'certificate_number', values: ['AA 08798136', 'AA 0798136'], evidence_ids: ['ev-1', 'ev-2', 'ev-3'], probable_ocr_error: true, outlier_evidence_ids: ['ev-3'] }] };
    const v = assetContextView(asset as never, [{ evidence_id: 'ev-3', file_name: 'dinh_gia_doi_chieu.pdf', doc_type_label: 'X' }] as never);
    expect(v).toMatchObject({ label: 'TSBĐ', tone: 'success', conflicts: ['Số GCN: AA 08798136 ≠ AA 0798136 — gần khớp, nghi lỗi đọc ở dinh_gia_doi_chieu.pdf'] });
    expect(v.reason).toContain('nghi lỗi đọc');
  });
});