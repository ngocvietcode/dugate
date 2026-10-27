// lib/logger.ts
// Enterprise structured logger for high-audit banking environments.
// Outputs JSON logs or formatted text depending on environment.
//
// ─── Redaction policy (per-SINK, not just per-LEVEL) ─────────────────────────
// Every line passes through lib/log-sanitize.ts. Two layers, two sinks.
//
//   SECRET layer  — ALWAYS on. Every level, every mode, every sink, including
//                   error, `raw()` and job.log(). No escape hatch exists.
//   CONTENT layer — mode is derived, no call-site changes needed:
//
//   sink        | mode
//   ------------|--------------------------------------------------------------
//   stdout      | raw()  >  LOG_REDACT_MODE=raw  >  level ERROR  >  redacted
//   job.log()   | ALWAYS redacted + whole-line cap LOG_JOBLOG_HARD_CAP
//
// The stdout/job.log() split is the important part. They are not two outputs of
// one pipeline, they are different sinks: stdout goes to Docker/CloudWatch which
// has its own rotation, while job.log() writes into the BullMQ `:logs` list in
// Redis RAM, which has NO rotation and only shrinks when the job is removed. So
// "show full content on error" applies to stdout only. Full content for a failed
// job still exists in two other places: stdout, and Postgres
// (Operation.extractedData / stepsResultJson / progressLogJson).
//
// See handover-report/DUImprovement/RedisLog/LOGGER_CONTENT_REDACTION_PLAN.md
// and 02-AMENDMENTS-LOGGER-PLAN.md §3 (A1) / §4 (A2).

import type { Job } from 'bullmq';
import { getLogRedactionConfig } from './config';
import {
  SANITIZE_ERROR,
  type SanitizeOptions,
  capLogLine,
  safeJsonStringify,
  sanitizeErrorForJobLog,
  sanitizeForLog,
  sanitizeLogError,
  sanitizeLogMessage,
  sanitizeLogMeta,
} from './log-sanitize';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Headroom reserved inside LOG_JOBLOG_HARD_CAP for the `[LEVEL] ` prefix and the
 * per-string truncation marker. Without it the whole-line cap would chop off the
 * `…(truncated, len=N)` suffix, and the operator reading Bull Board would not be
 * able to tell a short log line from a cut one.
 */
const JOBLOG_LINE_RESERVE = 96;

export interface LogContext {
  correlationId?: string;
  operationId?: string;
  apiKeyId?: string;
  service?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /**
   * Force CONTENT_FULL on the stdout sink regardless of level. Set via
   * {@link Logger.raw}. Has NO effect on SECRET redaction and NO effect on the
   * job.log() sink.
   */
  rawContent?: boolean;
}

/**
 * Chuỗi base64 thô dài (không có tiền tố `data:...;base64,`): ≥ 200 ký tự liên tục thuộc bảng chữ base64. Văn bản tiếng Việt/JSON thường
 * không chứa chuỗi liền như vậy vì có khoảng trắng, dấu câu và dấu ngoặc. Ngưỡng 200 tránh bắt nhầm hash/id (≤ 128 ký tự).
 * Giữ 16 ký tự đầu để còn nhận ra loại dữ liệu (`JVBERi0x…` = PDF), phần còn lại thay bằng độ dài.
 */
const RAW_BASE64_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/g;
export function stripRawBase64(text: string): string {
  return text.replace(RAW_BASE64_PATTERN, (match) => `${match.slice(0, 16)}<REDACTED_BASE64 chars=${match.length}>`);
}

export class Logger {
  private baseContext: LogContext;
  private job?: Job<any, any, any>;
  private minLevel: LogLevel;
  private isJson: boolean;
  private rawContent: boolean;

  private static levels: Record<LogLevel, number> = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
  };

  /**
   * Initializes a logger with a given base context.
   */
  constructor(context: LogContext = {}, job?: Job<any, any, any>, options: LoggerOptions = {}) {
    this.baseContext = context;
    this.job = job;
    this.rawContent = options.rawContent === true;

    // Set min level from env, default to INFO
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;
    this.minLevel = Logger.levels[envLevel] !== undefined ? envLevel : 'INFO';
    
    // Default to JSON logging in production environments (or if explicitly set)
    this.isJson = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';
  }

  /**
   * Creates a child logger inheriting current context.
   */
  public child(extraContext: LogContext): Logger {
    return new Logger(
      { ...this.baseContext, ...extraContext },
      this.job,
      { rawContent: this.rawContent },
    );
  }

  /**
   * Manual escape hatch: show full CONTENT on stdout at any level.
   *
   * Two uses:
   *  - investigating a specific info/warn line without flipping LOG_REDACT_MODE globally;
   *  - system logs (worker startup / shutdown / lifecycle), which carry operational
   *    metadata only — see plan §1.4 — and are classified as full CONTENT.
   *
   * SECRET redaction still applies, and job.log() is still REDACTED.
   */
  public raw(): Logger {
    return new Logger(this.baseContext, this.job, { rawContent: true });
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.levels[level] >= Logger.levels[this.minLevel];
  }

  /**
   * Defence in depth. lib/log-sanitize.ts already guarantees it never throws;
   * this second barrier exists because write() runs inside catch blocks and a
   * sanitizer failure must never mask the original error or kill the worker.
   * Note the fallback is a PLACEHOLDER — never the unfiltered value.
   */
  private static safely<T>(produce: () => T, fallback: T): T {
    try {
      return produce();
    } catch {
      return fallback;
    }
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>, error?: unknown) {
    if (!this.shouldLog(level)) return;

    const cfg = getLogRedactionConfig();

    // ── stdout sink: CONTENT mode derived from override > global > level ──
    const stdoutOpts: SanitizeOptions = {
      mode: this.rawContent || cfg.mode === 'raw' || level === 'ERROR' ? 'raw' : 'redacted',
      maxStringLen: cfg.maxStringLen,
      maxMessageLen: cfg.maxMessageLen,
      maxDepth: cfg.maxDepth,
      hardCap: cfg.rawHardCap,
    };

    const timestamp = new Date().toISOString();
    const safeMessage = Logger.safely(() => sanitizeLogMessage(message, stdoutOpts), SANITIZE_ERROR);
    const safeMeta = Logger.safely(() => sanitizeLogMeta(meta, stdoutOpts), { meta: SANITIZE_ERROR });
    const safeContext = Logger.safely(
      () => sanitizeLogMeta(this.baseContext as Record<string, unknown>, stdoutOpts),
      {},
    );

    const payload: Record<string, unknown> = {
      timestamp,
      level,
      message: safeMessage,
      ...safeContext,
      ...safeMeta,
    };

    if (error) {
      payload.error = Logger.safely(() => sanitizeLogError(error, stdoutOpts), SANITIZE_ERROR);
    }

    if (this.isJson) {
      const output = safeJsonStringify(payload);
      if (level === 'ERROR' || level === 'WARN') {
        console.error(output);
      } else {
        console.log(output);
      }
    } else {
      // Formatted text output for local development
      const corr = this.baseContext.correlationId ? `[${String(this.baseContext.correlationId)}] ` : '';
      const prefix = `${timestamp} [${level}] ${corr}`;

      const extraCtx = { ...safeContext };
      delete extraCtx.correlationId;

      const metaStr = Object.keys(extraCtx).length > 0 || meta
        ? ` | Meta: ${safeJsonStringify({ ...extraCtx, ...safeMeta })}`
        : '';
      // Dev format keeps the previous shape: the sanitized stack, unescaped, so it
      // stays readable in a terminal.
      const errObj = payload.error as { stack?: unknown; message?: unknown } | undefined;
      const errText = payload.error === undefined
        ? undefined
        : typeof payload.error === 'string'
          ? payload.error
          : typeof errObj?.stack === 'string'
            ? errObj.stack
            : typeof errObj?.message === 'string'
              ? errObj.message
              : safeJsonStringify(payload.error);
      const errStr = errText !== undefined ? `\n    Error: ${errText}` : '';

      const output = `${prefix}${safeMessage}${metaStr}${errStr}`;
      
      if (level === 'ERROR' || level === 'WARN') {
        console.error(output);
      } else {
        console.log(output);
      }
    }

    // ── Bull Board sink (Redis, no rotation): ALWAYS REDACTED ──
    // Deliberately ignores this.rawContent, LOG_REDACT_MODE and the ERROR-level
    // exemption. A failed job is the biggest producer of logger.error() calls and
    // is retained the longest (removeOnFail age), so this is where unbounded
    // content would actually accumulate. Amendment A1.
    if (this.job) {
      const jobBudget = cfg.jobLogHardCap > 0
        ? Math.max(1, cfg.jobLogHardCap - JOBLOG_LINE_RESERVE)
        : cfg.maxMessageLen;
      const jobOpts: SanitizeOptions = {
        mode: 'redacted',
        maxStringLen: Math.min(cfg.maxStringLen, jobBudget),
        maxMessageLen: Math.min(cfg.maxMessageLen, jobBudget),
        maxDepth: cfg.maxDepth,
        hardCap: cfg.jobLogHardCap,
      };

      const line = Logger.safely(() => {
        const jobMessage = sanitizeLogMessage(message, jobOpts);
        let dashboardStr = jobMessage;
        if (meta || error) {
          const jobMeta = sanitizeLogMeta(meta, jobOpts);
          const jobError = error ? sanitizeErrorForJobLog(error, jobOpts) : undefined;
          dashboardStr = `${jobMessage} | ${safeJsonStringify({ ...jobMeta, error: jobError })}`;
        }
        // Whole-line cap, not per-string: this is the only guarantee that one row
        // in `bull:<queue>:<jobId>:logs` stays bounded.
        return capLogLine(`[${level}] ${dashboardStr}`, jobOpts.hardCap);
      }, `[${level}] ${SANITIZE_ERROR}`);

      // Fire and forget
      this.job.log(line).catch(() => {});
    }
  }

  public debug(message: string, meta?: Record<string, unknown>) {
    this.write('DEBUG', message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>) {
    this.write('INFO', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>, error?: unknown) {
    this.write('WARN', message, meta, error);
  }

  public error(message: string, meta?: Record<string, unknown>, error?: unknown) {
    this.write('ERROR', message, meta, error);
  }

  /**
   * Ghi NỘI DUNG DÀI của lời gọi LLM (prompt / output) vào Bull Board (`job.log()`), để tra lỗi ngay trên job mà không cần mở log container.
   *
   * Đây là ngoại lệ có kiểm soát của quy tắc "job.log() luôn bị cắt", nên:
   *  - mặc định TẮT; bật bằng `LOG_JOB_LLM_IO=true` (chỉ nên bật ở môi trường test/điều tra, vì prompt chứa dữ liệu khách hàng và
   *    list `:logs` ở RAM Redis không xoay vòng, chỉ mất khi job bị xoá);
   *  - SECRET vẫn luôn bị che (api key, bearer, token, mật khẩu, credential trong URL) và base64 nhúng sẵn bị thay bằng độ dài;
   *  - cắt bằng trần riêng `LOG_JOB_LLM_IO_CAP` (mặc định 60.000 ký tự/dòng), không dùng `LOG_JOBLOG_HARD_CAP`;
   *  - KHÔNG ghi ra stdout (stdout đã có dòng đo độ dài; nội dung đầy đủ chỉ nằm ở job.log);
   *  - không có job gắn kèm (VD log hệ thống) hoặc công tắc tắt thì không làm gì.
   * Số dòng vẫn bị `KEEP_JOB_LOGS` chặn như mọi dòng log khác.
   */
  public jobLlmIo(label: string, content: string, meta?: Record<string, unknown>) {
    if (!this.job) return;
    const cfg = getLogRedactionConfig();
    if (!cfg.jobLlmIo) return;
    const line = Logger.safely(() => {
      const cap = cfg.jobLlmIoCap;
      const opts: SanitizeOptions = { mode: 'redacted', maxStringLen: cap, maxMessageLen: cap, maxDepth: cfg.maxDepth, hardCap: cap };
      const head = sanitizeLogMessage(label, opts);
      const info = meta ? ` | ${safeJsonStringify(sanitizeLogMeta(meta, { ...opts, maxStringLen: cfg.maxStringLen, hardCap: cfg.jobLogHardCap }))}` : '';
      // Nội dung đi qua cùng lớp SECRET + base64 của sanitizer, rồi mới cắt theo trần riêng. `content` không đi qua `sanitizeLogMeta`
      // để không bị "CONTENT key" (prompt/response...) cắt về 500 ký tự.
      // Base64 của file KHÔNG BAO GIỜ được ghi (giảm dung lượng Redis): `data:...;base64,` đã bị sanitizer thay; chuỗi base64 THÔ
      // (không có tiền tố, VD model trả lại nội dung file) bị `stripRawBase64` thay bằng độ dài.
      const body = stripRawBase64(sanitizeLogMessage(content, opts));
      return capLogLine(`[INFO] ${head}${info}\n${body}`, cap + JOBLOG_LINE_RESERVE);
    }, `[INFO] ${SANITIZE_ERROR}`);
    this.job.log(line).catch(() => {});
  }
}

/** Re-exported so callers can sanitize ad-hoc strings with the same rules. */
export { sanitizeForLog };
