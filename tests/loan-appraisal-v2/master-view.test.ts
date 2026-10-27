// T-MD-05 — hiển thị master_dossier theo checklist (MD-R14).
import { evidenceWhere, masterFieldRows, masterGroups, MASTER_STATUS_LABELS } from '@/app/loan-appraisal-v2/lib/master-view';

import { ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { runDossier } from '../loan-dossier/fixtures/master';

describe('master-view', () => {
  it('6 nhãn trạng thái (5 nhãn cũ không đổi, thêm CORRECTED — D-69)', () => {
    expect(MASTER_STATUS_LABELS).toEqual({
      AGREED: 'Thống nhất', OCR_NORMALIZED: 'Đã chuẩn hóa (nghi lỗi đọc)', SINGLE_SOURCE: 'Một nguồn', CONFLICT: 'Chưa thống nhất', MISSING: 'Thiếu',
      CORRECTED: 'Đã hiệu chỉnh (cần xác nhận)',
    });
  });

  it('nhóm theo checklist; mục chưa có bản hiện "Chưa có chứng từ"; bản lệch hiện mẫu biểu (file · tr.N)', async () => {
    const gcn = (book: string, file: string) => ({
      ...ev('land_use_certificate', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], assets: [{ asset_type: 'real_estate', identifiers: { certificate_number: 'AA 08798136', certificate_book_number: book } }] }),
      file_name: file,
    });
    const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }], { assets: [{ asset_type: 'real_estate', usage_context_hint: 'collateral', identifiers: { certificate_number: 'AA08798136' } }] });
    const { master, evidences } = await runDossier([app, gcn('CN 6475', 'so_do.pdf'), gcn('CN 6475', 'chung_thu.pdf'), gcn('CH.6475', 'dinh_gia_doi_chieu.pdf')]);
    const where = evidenceWhere(evidences);
    const groups = masterGroups(master, where);
    expect(groups[0].label).toBe('I. Hồ sơ pháp lý');
    const docs = groups.flatMap((g) => g.documents);
    expect(docs.some((d) => d.status_label === 'Chưa có chứng từ')).toBe(true);
    // D-65: mục "Không áp dụng" không có chứng từ không hiện trong master view
    expect(docs.some((d) => d.status_label === 'Không áp dụng')).toBe(false);
    expect(master.documents.some((d) => d.checklist_status === 'NOT_APPLICABLE')).toBe(true);
    const gcnDoc = [...master.documents, ...master.other_documents].find((d) => d.doc_type_key === 'land_use_certificate' && d.fields.length)!;
    const row = masterFieldRows(gcnDoc.fields, where).find((r) => r.key.endsWith('certificate_book_number'))!;
    expect(row).toMatchObject({ value: 'CN 6475', status_label: 'Đã chuẩn hóa (nghi lỗi đọc)', tone: 'info' });
    expect(row.details[0]).toMatch(/^Bản lệch: CH\.6475 — .+ \(dinh_gia_doi_chieu\.pdf · tr\.\d+/);
  });
});
