// app/ai-demo/lib/mock-data.ts
// Mock data generators for demo pipeline
// Extracted from page.tsx monolith for testability and reuse.

import type { UploadedFile } from '../types';

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getFileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📄';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '📊';
  if (name.endsWith('.zip')) return '📦';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return '🖼️';
  return '📎';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Logical Document Derivation ──────────────────────────────────────────────

export function deriveLogicalDocs(files: UploadedFile[]): UploadedFile[] {
  const docs: UploadedFile[] = [];
  files.forEach((f) => {
    if (f.name.includes('Bo_Chung_Tu') || f.name.includes('Scan_Full')) {
      docs.push({ id: `${f.id}-1`, name: 'Hợp đồng tín dụng (Trang 1-5)', size: 0, type: '', icon: '📄' });
      docs.push({ id: `${f.id}-2`, name: 'Hóa đơn GTGT (Trang 6)', size: 0, type: '', icon: '🧾' });
      docs.push({ id: `${f.id}-3`, name: 'Đề nghị giải ngân (Trang 7-8)', size: 0, type: '', icon: '📝' });
    } else if (f.name.includes('PhuLuc')) {
      docs.push({ id: `${f.id}-1`, name: 'Phụ lục thiết kế (Trang 1-2)', size: 0, type: '', icon: '📄' });
      docs.push({ id: `${f.id}-2`, name: 'Bản vẽ đính kèm (Trang 3)', size: 0, type: '', icon: '🖼️' });
    } else {
      let label = 'Tài liệu độc lập';
      if (f.name.includes('UyNhiemChi')) label = 'Ủy nhiệm chi';
      if (f.name.includes('HoaDon')) label = 'Hóa đơn';
      if (f.name.includes('BangKe')) label = 'Bảng kê';
      docs.push({ id: `${f.id}-1`, name: `${label} - ${f.name}`, size: f.size, type: f.type, icon: f.icon });
    }
  });
  return docs;
}

// ─── Mock Output Generators ───────────────────────────────────────────────────

export function mockClassifyOutput(files: UploadedFile[]): string {
  const logicals = deriveLogicalDocs(files);
  const result = {
    status: 'success',
    action: 'split-and-classify',
    physical_files_processed: files.length,
    process_time: '2.4s',
    logical_documents: logicals.map((d) => ({
      id: d.id,
      label: d.name.split(' (')[0].split(' - ')[0],
      confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
      source_file: d.name.includes(' - ') ? d.name.split(' - ')[1] : d.name,
      icon: d.icon,
    })),
  };
  return JSON.stringify(result, null, 2);
}

export function mockOcrOutputSingle(f: UploadedFile, i: number): string {
  const result = {
    file: f.name,
    pages_processed: 1 + Math.floor(Math.random() * 8),
    extracted_fields: f.name.includes('.pdf')
      ? {
          'Số hợp đồng': `HD-2024-${String(1000 + i).padStart(4, '0')}`,
          'Bên A': 'Ngân hàng TMCP ABC - Chi nhánh Hà Nội',
          'Bên B': 'Công ty TNHH XYZ Việt Nam',
          'Giá trị hợp đồng': `${(500 + Math.floor(Math.random() * 9500)).toLocaleString('vi-VN')} triệu VND`,
          'Ngày ký': '15/01/2024',
          'Thời hạn': '12 tháng',
          'Lãi suất': `${(6.5 + Math.random() * 3).toFixed(1)}%/năm`,
          'Tài sản đảm bảo': 'Quyền sử dụng đất tại 123 Láng Hạ, Đống Đa, Hà Nội',
        }
      : {
          'Số chứng từ': `CT-${String(2024000 + i)}`,
          'Người đề nghị': 'Nguyễn Văn An - Phòng Kinh Doanh',
          'Số tiền': `${(50 + Math.floor(Math.random() * 950)).toLocaleString('vi-VN')} triệu VND`,
          'Mục đích': 'Thanh toán tiền hàng theo HĐ số HD-2024-1000',
          'Ngày lập': '20/03/2024',
          'Trạng thái phê duyệt': 'Đã ký duyệt (2/3 cấp)',
        },
    confidence_avg: parseFloat((0.88 + Math.random() * 0.11).toFixed(2)),
  };
  return JSON.stringify(result, null, 2);
}

export function mockCrosscheckOutput(): string {
  return JSON.stringify(
    {
      cross_check_report: {
        status: 'ISSUES_FOUND',
        total_checks: 12,
        passed: 9,
        warnings: 2,
        errors: 1,
        details: [
          { field: 'Giá trị giải ngân', expected: '2,500 triệu VND', actual: '2,500 triệu VND', status: '✅ PASS', severity: 'info' },
          { field: 'Lãi suất áp dụng', expected: '8.5%/năm (theo NQ)', actual: '8.5%/năm', status: '✅ PASS', severity: 'info' },
          { field: 'Tài sản đảm bảo', expected: 'QSDĐ tại 123 Láng Hạ', actual: 'QSDĐ tại 123 Láng Hạ, Đống Đa', status: '✅ PASS', severity: 'info' },
          { field: 'Thời hạn vay', expected: '12 tháng', actual: '18 tháng', status: '⚠️ WARNING', severity: 'warning', note: 'Thời hạn thực tế dài hơn Nghị quyết quy định 6 tháng' },
          { field: 'Mục đích sử dụng vốn', expected: 'Bổ sung vốn lưu động', actual: 'Bổ sung VLĐ + Mua sắm TSCĐ', status: '⚠️ WARNING', severity: 'warning', note: 'Mục đích mở rộng hơn so với NQ phê duyệt' },
          { field: 'Hạn mức tín dụng', expected: '3,000 triệu VND', actual: '3,500 triệu VND', status: '❌ ERROR', severity: 'error', note: 'Vượt hạn mức Nghị quyết 500 triệu VND (16.7%)' },
          { field: 'Phí quản lý khoản vay', expected: '0.5%', actual: '0.5%', status: '✅ PASS', severity: 'info' },
          { field: 'Phương thức trả nợ', expected: 'Trả gốc cuối kỳ', actual: 'Trả gốc cuối kỳ', status: '✅ PASS', severity: 'info' },
          { field: 'Ngày giải ngân', expected: 'Trong vòng 30 ngày', actual: '25/03/2024 (ngày 25)', status: '✅ PASS', severity: 'info' },
        ],
      },
      resolution_ref: 'NQ-HĐQT-2024/015',
      checked_at: new Date().toISOString(),
    },
    null,
    2,
  );
}

export function mockTotrinhOutput(): string {
  return `# TỜ TRÌNH ĐÁNH GIÁ TUÂN THỦ NGHỊ QUYẾT

## I. Thông tin Khoản vay
| Hạng mục | Chi tiết |
|----------|----------|
| Khách hàng | Công ty TNHH XYZ Việt Nam |
| MST | 0101234567 |
| Số Nghị quyết | NQ-HĐQT-2024/015 ngày 10/01/2024 |
| Hạn mức phê duyệt | 3,000 triệu VND |
| Sản phẩm | Cho vay bổ sung vốn lưu động |

## II. Đánh giá Tuân thủ Nghị quyết

### 2.1 Các điều khoản tuân thủ đầy đủ (9/12 hạng mục)
Hồ sơ giải ngân cơ bản **đáp ứng** các điều kiện về lãi suất (8.5%/năm), 
tài sản đảm bảo (QSDĐ tại 123 Láng Hạ), phương thức trả nợ và thời hạn
giải ngân theo quy định tại Nghị quyết.

### 2.2 Các hạng mục cần lưu ý (2 cảnh báo)
- **Thời hạn vay**: Chứng từ thể hiện thời hạn 18 tháng, trong khi NQ phê duyệt 
  12 tháng. Đề xuất: Cần bổ sung phê duyệt gia hạn từ cấp có thẩm quyền.
- **Mục đích sử dụng vốn**: Ngoài bổ sung VLĐ, chứng từ có thêm mục "Mua sắm TSCĐ" 
  chưa được NQ đề cập. Cần làm rõ tỷ trọng phân bổ.

### 2.3 ❌ Vi phạm phát hiện (1 lỗi nghiêm trọng)
> **Hạn mức tín dụng vượt Nghị quyết**: Giá trị đề nghị giải ngân là 3,500 triệu VND, 
> vượt hạn mức NQ phê duyệt (3,000 triệu VND) **500 triệu VND (16.7%)**. 
> Theo Quy chế nội bộ, khoản chênh lệch này cần được phê duyệt bổ sung bởi 
> Hội đồng Tín dụng cấp Trung ương.

## III. Kết luận & Kiến nghị
Hồ sơ giải ngân **chưa đủ điều kiện** thực hiện do vi phạm hạn mức. 
Kiến nghị: Trình HĐTD phê duyệt bổ sung hạn mức trước khi tiếp tục quy trình.

---
*Tờ trình được tạo tự động bởi AI Agent — Dugate v2.0*
*Ngày tạo: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}*`;
}

// ─── Sample Files ─────────────────────────────────────────────────────────────

export function getSampleFiles(): UploadedFile[] {
  return [
    { id: crypto.randomUUID(), name: 'Bo_Chung_Tu_Scan_Full.pdf', size: 10485760, type: 'application/pdf', icon: '📄' },
    { id: crypto.randomUUID(), name: 'PhuLuc_HopDong_Scan.pdf', size: 3145728, type: 'application/pdf', icon: '📄' },
    { id: crypto.randomUUID(), name: 'UyNhiemChi_001.pdf', size: 1024000, type: 'application/pdf', icon: '📄' },
    { id: crypto.randomUUID(), name: 'HoaDon_VAT_0015.pdf', size: 1234567, type: 'application/pdf', icon: '📄' },
    { id: crypto.randomUUID(), name: 'BangKe_ChungTu_GiaiNgan.xlsx', size: 567890, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', icon: '📊' },
  ];
}

// ─── Initial Pipeline Steps ───────────────────────────────────────────────────

export function getInitialSteps() {
  return [
    {
      id: 'classify',
      title: 'AI Classify',
      subtitle: 'Phân loại tài liệu & Đặt tên chuẩn hóa',
      icon: '🏷️',
      accentColor: 'from-violet-500 to-indigo-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'ocr',
      title: 'OCR & Bóc tách (Song song)',
      subtitle: 'Nhận dạng ký tự & Trích xuất dữ liệu',
      icon: '🔍',
      accentColor: 'from-cyan-500 to-blue-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isParallel: true,
      isCollapsed: false,
    },
    {
      id: 'crosscheck',
      title: 'AI Cross-check',
      subtitle: 'Đối chiếu chứng từ & Nghị quyết',
      icon: '⚖️',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'totrinh',
      title: 'AI Agent Tờ trình',
      subtitle: 'Soạn tờ trình đánh giá tuân thủ',
      icon: '📋',
      accentColor: 'from-emerald-500 to-teal-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
  ];
}
