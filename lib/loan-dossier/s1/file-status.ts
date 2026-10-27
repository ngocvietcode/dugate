// Bảng trạng thái file → mã lý do (T-S1-02; S1-R05, S1 §4). Thông báo lấy đúng chuỗi trong spec.

export type FileOutcomeKind =
  | 'CLASSIFIED'
  | 'UNSUPPORTED_FORMAT'
  | 'PASSWORD_PROTECTED'
  | 'CORRUPTED_FILE'
  | 'EMPTY_OR_UNREADABLE'
  | 'LOW_QUALITY_UNREADABLE'
  | 'UNCLASSIFIED';

export type FileStatus = 'CLASSIFIED' | 'UNSUPPORTED_FILE' | 'PASSWORD_PROTECTED' | 'CORRUPTED_FILE' | 'UNKNOWN';

export interface FileOutcome {
  status: FileStatus;
  reason_code: string | null;
  next_action: string | null;
  message: string | null;
}

const TABLE: Record<FileOutcomeKind, FileOutcome> = {
  CLASSIFIED: { status: 'CLASSIFIED', reason_code: null, next_action: null, message: null },
  UNSUPPORTED_FORMAT: {
    status: 'UNSUPPORTED_FILE', reason_code: 'UNSUPPORTED_FORMAT', next_action: 'CONVERT_AND_REUPLOAD',
    message: 'Định dạng {ext} chưa được hỗ trợ. Vui lòng chuyển sang PDF hoặc ảnh (.jpg, .jpeg, .png) và tải lại.',
  },
  PASSWORD_PROTECTED: {
    status: 'PASSWORD_PROTECTED', reason_code: 'PASSWORD_PROTECTED', next_action: 'REMOVE_PASSWORD_AND_REUPLOAD',
    message: 'File PDF đang đặt mật khẩu. Vui lòng gỡ mật khẩu và tải lại.',
  },
  CORRUPTED_FILE: {
    status: 'CORRUPTED_FILE', reason_code: 'CORRUPTED_FILE', next_action: 'RESCAN_AND_REUPLOAD',
    message: 'File bị hỏng, không mở được. Vui lòng scan/xuất lại và tải lên.',
  },
  EMPTY_OR_UNREADABLE: {
    status: 'UNKNOWN', reason_code: 'EMPTY_OR_UNREADABLE', next_action: 'RESCAN_AND_REUPLOAD',
    message: 'File không có nội dung đọc được. Vui lòng kiểm tra và tải lại.',
  },
  LOW_QUALITY_UNREADABLE: {
    status: 'UNKNOWN', reason_code: 'LOW_QUALITY_UNREADABLE', next_action: 'RESCAN_AND_REUPLOAD',
    message: 'Ảnh/scan quá mờ, không nhận diện được. Vui lòng scan lại rõ hơn.',
  },
  UNCLASSIFIED: {
    status: 'UNKNOWN', reason_code: 'UNCLASSIFIED', next_action: null,
    message: 'Không xác định được loại chứng từ thuộc danh mục hồ sơ.',
  },
};

export const FILE_OUTCOME_KINDS = Object.keys(TABLE) as FileOutcomeKind[];

/** Đuôi file để hiển thị trong thông báo (`.docx`); không có đuôi → `(không rõ)`. */
export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 && i < fileName.length - 1 ? fileName.slice(i).toLowerCase() : '(không rõ)';
}

export function fileOutcome(kind: FileOutcomeKind, ctx: { ext?: string } = {}): FileOutcome {
  const row = TABLE[kind];
  return { ...row, message: row.message?.replace('{ext}', ctx.ext ?? '(không rõ)') ?? null };
}
