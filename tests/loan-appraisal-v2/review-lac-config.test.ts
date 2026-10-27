import type { MetricResult } from '@/app/loan-appraisal/types';
import type { LoanApplicationContextSummary } from '@/lib/pipelines/workflows/loan-appraisal/types';
import { metricBadge } from '@/app/loan-appraisal-v2/lib/metric-badge';
import { lacSummaryView } from '@/app/loan-appraisal-v2/lib/lac-summary';
import { readChecks, serialize } from '@/app/loan-appraisal-v2/lib/checks-config';

describe('Nhãn chỉ số tài chính', () => {
  const metric: MetricResult = { status: 'CALCULATED', value: 2, unit: 'RATIO', formula: '', warnings: [] };
  it.each([
    [undefined, 'Đang chờ', 'neutral'],
    [metric, 'Đã tính', 'success'],
    [{ ...metric, value: null }, 'Đã tính', 'success'],
    [{ ...metric, needs_review: true }, 'Cần soát', 'warning'],
    [{ ...metric, input_conflict: true }, 'Đã tính', 'success'],
    [{ ...metric, status: 'INSUFFICIENT_DATA', needs_review: true }, 'Thiếu dữ liệu', 'neutral'],
    [{ ...metric, status: 'NOT_APPLICABLE' }, 'Không áp dụng', 'neutral'],
  ] as const)('ánh xạ %j', (input, label, tone) => {
    expect(metricBadge(input)).toEqual({ label, tone });
  });
});

describe('Tóm tắt ngữ cảnh đơn vay', () => {
  const summary: LoanApplicationContextSummary = {
    lac_version: '1.0', mode: 'shadow', used_in_prompt: false,
    source_hash: '0123456789abcdef0123456789abcdef', fact_count: 4,
    rendered_fact_count: null, conflicts: 2, gaps: [],
  };
  it('ẩn khi không có tóm tắt', () => {
    expect(lacSummaryView()).toBeNull();
    expect(lacSummaryView(null)).toBeNull();
  });
  it('hiển thị chế độ thử, số đếm và chỉ 12 ký tự mã nguồn', () => {
    expect(lacSummaryView(summary)).toEqual({ rows: [
      { label: 'Phiên bản', value: '1.0' },
      { label: 'Chế độ', value: 'Chạy thử (chỉ đo, không đổi kết quả)' },
      { label: 'Đã dùng trong prompt', value: 'Không' },
      { label: 'Mã nguồn dữ liệu', value: '0123456789ab' },
      { label: 'Số dữ kiện', value: '4' },
      { label: 'Số dữ kiện đưa vào prompt', value: 'Không áp dụng' },
      { label: 'Số mâu thuẫn', value: '2' },
    ], gaps: [] });
  });
  it('hiển thị chế độ dùng thật và giữ số 0', () => {
    const view = lacSummaryView({ ...summary, mode: 'on', used_in_prompt: true, rendered_fact_count: 0 });
    expect(view?.rows).toEqual(expect.arrayContaining([
      { label: 'Chế độ', value: 'Đang dùng cho rule LLM' },
      { label: 'Đã dùng trong prompt', value: 'Có' },
      { label: 'Số dữ kiện đưa vào prompt', value: '0' },
    ]));
  });
  it.each([
    ['NO_LOAN_APPLICATION', 'Không có giấy đề nghị vay đọc được'],
    ['S3_UNAVAILABLE', 'Chưa gom được người & tài sản'],
    ['PARTY_NOT_MAPPED', 'Người trên chứng từ chưa gắn được vào hồ sơ'],
    ['ASSET_NOT_MAPPED', 'Tài sản trên chứng từ chưa gắn được vào hồ sơ'],
    ['EVIDENCE_READ_ERROR', 'Chứng từ không đọc được'],
    ['SUPERSEDED_EVIDENCE', 'Bản đã bị thay thế bởi bản mới hơn'],
    ['LOAN_APPLICATION_DUPLICATE', 'Nhiều giấy đề nghị vay ghi khác nhau về khoản vay'],
    ['NEW_GAP', 'NEW_GAP'],
    ['constructor', 'constructor'],
  ])('dịch khoảng trống %s', (code, label) => {
    expect(lacSummaryView({ ...summary, gaps: [{ code, count: 3 }] })?.gaps).toEqual([`${label}: 3`]);
  });
});

describe('Lưu quyền PASS theo lời khai', () => {
  it('giữ nguồn dữ liệu và phiên bản của rule khi lưu lại', () => {
    const saved = { checks: [
      { id: 'LOAN.CUSTOM.TEST', input: ['evidence.id_card'], version: '2.3.0', prompt: 'Kiểm tra' },
      { id: 'LOAN.CAPACITY.MIN_DSCR', input: ['evidence.loan_application'], version: '4.0.0' },
    ] };
    const serialized = serialize(readChecks(saved));
    expect(serialized.find((c) => c.id === 'LOAN.CUSTOM.TEST')).toMatchObject(saved.checks[0]);
    expect(serialized.find((c) => c.id === 'LOAN.CAPACITY.MIN_DSCR')).toMatchObject({
      input: ['evidence.loan_application', 'financial.dscr'], version: '4.0.0',
    });
    expect(serialize(readChecks({ checks: serialized }))).toEqual(serialized);
  });
  it('đọc và lưu lại true cùng ngưỡng và ngoại lệ', () => {
    const saved = { checks: [{ id: 'LOAN.CUSTOM.TEST', kind: 'PROMPT', allow_declared_pass: true, threshold: 0.9, exception_allowed: true, prompt: 'Kiểm tra' }] };
    const serialized = serialize(readChecks(saved));
    expect(serialized.find((c) => c.id === 'LOAN.CUSTOM.TEST')).toMatchObject(saved.checks[0]);
    expect(serialize(readChecks({ checks: serialized }))).toEqual(serialized);
  });
  it.each([false, undefined])('bỏ trường khi %s và khi bỏ chọn', (allow_declared_pass) => {
    const checks = readChecks({ checks: [{ id: 'LOAN.CUSTOM.TEST', allow_declared_pass }] });
    expect(serialize(checks).find((c) => c.id === 'LOAN.CUSTOM.TEST')).not.toHaveProperty('allow_declared_pass');
    const enabled = checks.map((c) => c.id === 'LOAN.CUSTOM.TEST' ? { ...c, allow_declared_pass: true } : c);
    const reread = readChecks({ checks: serialize(enabled) });
    expect(serialize(reread.map((c) => ({ ...c, allow_declared_pass: false }))).every((c) => !('allow_declared_pass' in c))).toBe(true);
  });
  it('không lưu quyền này cho rule engine', () => {
    const checks = readChecks(undefined);
    expect(serialize(checks.filter((c) => c.kind === 'DETERMINISTIC').map((c) => ({ ...c, allow_declared_pass: true }))).every((c) => !('allow_declared_pass' in c))).toBe(true);
  });
});
