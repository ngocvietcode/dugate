// T-S1-02 — bảng trạng thái file → mã lý do (S1 §4).
import { isReasonCode } from '@/lib/loan-dossier/catalog';
import { FILE_OUTCOME_KINDS, fileExtension, fileOutcome } from '@/lib/loan-dossier/s1/file-status';

describe('fileOutcome', () => {
  it.each([
    ['CLASSIFIED', 'CLASSIFIED', null, null],
    ['UNSUPPORTED_FORMAT', 'UNSUPPORTED_FILE', 'UNSUPPORTED_FORMAT', 'CONVERT_AND_REUPLOAD'],
    ['PASSWORD_PROTECTED', 'PASSWORD_PROTECTED', 'PASSWORD_PROTECTED', 'REMOVE_PASSWORD_AND_REUPLOAD'],
    ['CORRUPTED_FILE', 'CORRUPTED_FILE', 'CORRUPTED_FILE', 'RESCAN_AND_REUPLOAD'],
    ['EMPTY_OR_UNREADABLE', 'UNKNOWN', 'EMPTY_OR_UNREADABLE', 'RESCAN_AND_REUPLOAD'],
    ['LOW_QUALITY_UNREADABLE', 'UNKNOWN', 'LOW_QUALITY_UNREADABLE', 'RESCAN_AND_REUPLOAD'],
    ['UNCLASSIFIED', 'UNKNOWN', 'UNCLASSIFIED', null],
  ] as const)('%s → %s / %s / %s', (kind, status, reason, next) => {
    const o = fileOutcome(kind);
    expect([o.status, o.reason_code, o.next_action]).toEqual([status, reason, next]);
    expect(kind === 'CLASSIFIED' ? o.message === null : typeof o.message === 'string').toBe(true);
  });

  it('đủ 7 dòng của bảng §4', () => {
    expect(FILE_OUTCOME_KINDS).toHaveLength(7);
  });

  it('UNSUPPORTED_FORMAT thay {ext}', () => {
    const o = fileOutcome('UNSUPPORTED_FORMAT', { ext: fileExtension('Hop dong.DOCX') });
    expect(o.message).toBe('Định dạng .docx chưa được hỗ trợ. Vui lòng chuyển sang PDF hoặc ảnh (.jpg, .jpeg, .png) và tải lại.');
  });

  it('mọi reason_code có trong reason_codes.json scope FILE', () => {
    for (const kind of FILE_OUTCOME_KINDS) {
      const code = fileOutcome(kind).reason_code;
      if (code !== null) expect(isReasonCode(code, 'FILE')).toBe(true);
    }
  });
});
