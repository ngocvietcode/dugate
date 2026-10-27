import { REPORT_TYPES } from '@/lib/pipelines/workflows/financial-report/types';
import type {
  BilingualText,
  FinancialReportEnvelope,
  FinancialReportPayload,
  NotesReport,
  ReportType,
  TabularReport,
} from '@/lib/pipelines/workflows/financial-report/types';

export const FINANCIAL_REPORT_OPERATION_SLUG = 'workflows:financial-report-translation';
export const FOREGROUND_POLL_WINDOW_MS = 2 * 60 * 1000;
export const BACKGROUND_POLL_INTERVAL_MS = 25 * 1000;
export const DEFAULT_ETA_SECONDS_PER_PAGE = 13;
export const INITIAL_COMPLETION_ESTIMATE_MS = 15 * 60 * 1000;
export const LONG_FILE_PAGE_THRESHOLD = 40;

export interface FinancialReportHistoryOperation {
  name: string;
  done: boolean;
  input_files: string[];
  metadata: {
    state: string;
    endpoint_slug: string | null;
    current_step: number;
    progress_percent: number;
    progress_message: string | null;
    create_time: string | null;
    update_time: string | null;
  };
}

export function isWorkflowDeadlineFailure(message: string | null | undefined): boolean {
  return typeof message === 'string' && /(?:time budget|deadline)/i.test(message);
}

export const WORKFLOW_DEADLINE_GUIDANCE = 'File quá lớn hoặc backend chậm nên vượt giới hạn thời gian. Bạn có thể: (1) tách file nhỏ hơn rồi chạy lại, (2) nhờ admin nới workflow_deadline_ms trên Profile, (3) bấm Chạy lại bên dưới.';

/**
 * Return a display-only filename without exposing a storage path, URL query, or control character.
 * This helper deliberately does not validate or resolve paths; it is only for an already-authorized UI response.
 */
export function safeDisplayFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const baseName = value
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.split(/[?#]/, 1)[0]
    ?.normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 160);

  return baseName || null;
}

/** Parse filesJson only on the server and reduce it to bounded display names. */
export function safeInputFileNames(filesJson: string | null | undefined): string[] {
  if (!filesJson) return [];

  try {
    const parsed: unknown = JSON.parse(filesJson);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const names: string[] = [];
    for (const file of parsed) {
      const name = file && typeof file === 'object'
        ? safeDisplayFileName((file as { name?: unknown }).name)
        : null;
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      if (names.length === 20) break;
    }
    return names;
  } catch {
    return [];
  }
}

/** The browser follows each new operation for exactly two minutes before switching to background status. */
export function foregroundPollDeadline(startedAt: Date): Date {
  return new Date(startedAt.getTime() + FOREGROUND_POLL_WINDOW_MS);
}

function validPositiveInteger(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizedSecondsPerPage(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_ETA_SECONDS_PER_PAGE;
  return Math.min(120, Math.max(1, value));
}

/**
 * Produce the conservative initial duration for a known page count. Missing page metadata
 * preserves the legacy fallback so an older operation never receives a fabricated ETA.
 */
export function initialEstimateDurationMs(totalPages?: number | null, secondsPerPage?: number | null): number {
  if (!validPositiveInteger(totalPages)) return INITIAL_COMPLETION_ESTIMATE_MS;
  return Math.round(totalPages * normalizedSecondsPerPage(secondsPerPage) * 1000);
}

/**
 * Refine a page-count estimate only after measurable work exists. The observed rate is blended
 * with the configured baseline and bounded to prevent a slow first call from producing nonsense.
 */
export function refinedRemainingDurationMs({
  totalPages,
  secondsPerPage,
  progressPercent,
  elapsedMs,
}: {
  totalPages?: number | null;
  secondsPerPage?: number | null;
  progressPercent?: number | null;
  elapsedMs?: number | null;
}): number {
  const initial = initialEstimateDurationMs(totalPages, secondsPerPage);
  if (!validPositiveInteger(totalPages)) return initial;

  const percent = Number.isFinite(progressPercent) ? Math.min(100, Math.max(0, progressPercent ?? 0)) : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs ?? 0) : 0;
  if (percent <= 0 || elapsed <= 0) return initial;
  if (percent >= 100) return 0;

  const completedPages = Math.max(1, totalPages * percent / 100);
  const baseline = normalizedSecondsPerPage(secondsPerPage) * 1000;
  const observed = elapsed / completedPages;
  const effectiveRate = Math.min(baseline * 4, Math.max(baseline / 4, (baseline + observed) / 2));
  return Math.max(0, Math.round((totalPages - completedPages) * effectiveRate));
}

export function initialCompletionEstimate(
  startedAt: Date,
  totalPages?: number | null,
  secondsPerPage?: number | null,
): Date {
  return new Date(startedAt.getTime() + initialEstimateDurationMs(totalPages, secondsPerPage));
}

export function formatRemainingEstimate(remainingMs: number): string {
  if (remainingMs <= 0) return 'Đang hoàn tất kết quả…';
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Ước tính còn khoảng ${totalMinutes} phút (ước lượng, không phải SLA).`;
}

export function formatCompletionEstimate(
  startedAt: Date,
  totalPages?: number | null,
  secondsPerPage?: number | null,
  progressPercent?: number | null,
  now = Date.now(),
): string {
  return formatRemainingEstimate(refinedRemainingDurationMs({
    totalPages,
    secondsPerPage,
    progressPercent,
    elapsedMs: now - startedAt.getTime(),
  }));
}

function markdownText(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return '—';
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br />');
}

function bilingualText(value: BilingualText | null | undefined): string {
  if (!value) return '—';
  const source = value.source?.trim() ?? '';
  const translated = value.translated?.trim() ?? '';
  if (source && translated && source !== translated) return markdownText(`${source} / ${translated}`);
  return markdownText(translated || source);
}

function writeWarnings(lines: string[], warnings: Array<{ code: string; message: string }>): void {
  if (warnings.length === 0) return;
  lines.push('', 'Cảnh báo:');
  warnings.forEach((warning) => lines.push(`- \`${markdownText(warning.code)}\` — ${markdownText(warning.message)}`));
}

function writeTabularReport(lines: string[], report: TabularReport): void {
  report.tables.forEach((table, tableIndex) => {
    lines.push('', `#### Bảng ${tableIndex + 1}`);
    if (table.columns.length === 0) {
      lines.push('', '_Không có cột dữ liệu._');
      return;
    }

    const headers = table.columns.map((column) => bilingualText(column.label));
    lines.push('', `| Khoản mục | ${headers.join(' | ')} |`);
    lines.push(`| ${Array.from({ length: headers.length + 1 }, () => '---').join(' | ')} |`);
    table.rows.forEach((row) => {
      const values = table.columns.map((column) => markdownText(row.values[column.id]?.raw));
      lines.push(`| ${bilingualText(row.label)} | ${values.join(' | ')} |`);
    });
  });
}

function writeNotesReport(lines: string[], report: NotesReport): void {
  report.sections.forEach((section, index) => {
    lines.push('', `#### ${index + 1}. ${bilingualText(section.title)}`);
    lines.push('', markdownText(section.translatedText || section.sourceText));
  });
}

function isNotesReport(report: TabularReport | NotesReport): report is NotesReport {
  return 'sections' in report;
}

function writeReport(lines: string[], reportType: ReportType, report: TabularReport | NotesReport): void {
  lines.push('', `### ${bilingualText(report.title)}`, '', `- Mã báo cáo: \`${reportType}\``, `- Trạng thái: **${report.status}**`);
  writeWarnings(lines, report.warnings);
  if (isNotesReport(report)) writeNotesReport(lines, report);
  else writeTabularReport(lines, report);
}

/** Render only report keys present in the public envelope; suppressed outputs are never invented. */
export function financialReportToMarkdown(envelope: FinancialReportEnvelope): string {
  const lines = [
    '# Kết quả OCR & Dịch Báo cáo tài chính',
    '',
    `- Request ID: \`${markdownText(envelope.requestId)}\``,
    `- Mã kết quả: **${envelope.code}**`,
    `- Thông điệp: ${markdownText(envelope.message)}`,
    `- Ngôn ngữ đích: \`${markdownText(envelope.targetLang)}\``,
    `- Thời điểm: ${markdownText(envelope.timestamp)}`,
  ];

  const files = envelope.data ?? [];
  if (files.length === 0) {
    lines.push('', '_Không có file kết quả._');
    return `${lines.join('\n')}\n`;
  }

  files.forEach((file, fileIndex) => {
    lines.push('', `## ${fileIndex + 1}. ${markdownText(file.fileName)}`, '', `- Trạng thái file: **${file.status}**`);
    if (file.errorCode) lines.push(`- Mã lỗi: \`${markdownText(file.errorCode)}\``);
    if (file.errorMessage) lines.push(`- Thông điệp lỗi: ${markdownText(file.errorMessage)}`);
    if (!file.report) return;

    const report: FinancialReportPayload = file.report;
    lines.push('', '### Thông tin chung', '', `- Công ty: ${bilingualText(report.generalInformation.companyName)}`);
    for (const reportType of REPORT_TYPES) {
      const reportData = report[reportType];
      if (!reportData) continue;
      writeReport(lines, reportType, reportData);
    }
  });

  return `${lines.join('\n')}\n`;
}
