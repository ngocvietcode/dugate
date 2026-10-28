// T-FS-04 — gộp thống kê shadow của Fellegi-Sunter; chỉ số đếm, không chiếu trường văn bản.
import { readOperation, renderFsReport } from '../../scripts/lib/fs-shadow';

const op = (counts: Record<string, number>) => ({
  metadata: { state: 'SUCCEEDED' },
  result: { extracted_data: { s3_matcher_summary: { mode: 'shadow', params_version: '0.1.0-expert', note: 'PRIVATE_SENTINEL', ...counts } } },
});

test('gộp 2 Operation, bỏ qua Operation không có shadow', () => {
  const rows = [
    readOperation('op-1', op({ parties: 3, same: 2, fs_only: 1 })),
    readOperation('op-2', op({ parties: 2, same: 1, rules_only: 1, fs_possible: 1 })),
    readOperation('op-3', { metadata: { state: 'SUCCEEDED' }, result: { extracted_data: {} } }),
  ];
  const report = renderFsReport(rows);
  expect(report.total).toEqual({ parties: 5, same: 3, rules_only: 1, fs_only: 1, different_person: 0, fs_possible: 1, fs_ambiguous: 0 });
  expect(report.markdown).toContain('with shadow summary: 2');
  expect(report.markdown + report.csv).not.toContain('PRIVATE_SENTINEL');
});
