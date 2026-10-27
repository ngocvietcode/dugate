// lib/config.ts
// Centralized application configuration.
// All magic numbers, timeouts, limits, and model pricing live here.

// ─── File limits ──────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './outputs';

// ─── Worker ───────────────────────────────────────────────────────────────────

export const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
export const SUBSTEP_WORKER_CONCURRENCY = parseInt(process.env.SUBSTEP_WORKER_CONCURRENCY || String(WORKER_CONCURRENCY * 2), 10);
/**
 * Slot của worker queue `workflow` (job workflow cha). Job cha chủ yếu chờ sub-step (I/O), nên mặc định gấp đôi
 * WORKER_CONCURRENCY; trần thật là bộ nhớ — bộ giám sát heap của worker (dừng ở 90 %) phủ cả worker này.
 */
export const WORKFLOW_CONCURRENCY = parseInt(process.env.WORKFLOW_CONCURRENCY || String(WORKER_CONCURRENCY * 2), 10);
export const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '500', 10);
export const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '30000', 10);
export const WORKER_MEMORY_THRESHOLD = parseFloat(process.env.WORKER_MEMORY_THRESHOLD || '0.90');

// ─── Queue job log retention ──────────────────────────────────────────────────
// BullMQ only trims the per-job Redis list `bull:<queue>:<jobId>:logs` when
// `keepLogs` is set. Without it the list grows without bound.
//
// PLACEMENT: `keepLogs` is a JOB option, not a Worker option. BullMQ 5.x
// `Job.prototype.log()` does `Job.addJobLog(queue, id, row, this.opts.keepLogs)`
// and `WorkerOptions` has no `keepLogs` field at all. So the cap must be set in
// every queue's `defaultJobOptions` — see getQueueRetentionOptions() below.
// Consequence: like removeOnComplete/removeOnFail, it is frozen at `add` time and
// only applies to NEW jobs.
export const KEEP_JOB_LOGS = parseInt(process.env.KEEP_JOB_LOGS || '100', 10);

// ─── Queue job retention ──────────────────────────────────────────────────────
// Env is expressed in ms to stay consistent with the rest of the codebase
// (SYNC_TIMEOUT_MS, VAULT_*_MS…). BullMQ `age` is in SECONDS → convert here, once.
// ONE env drives age for BOTH completed and failed jobs.
// 604800000 (7 days) is a FALLBACK, not a policy — Ops sets the real value via env.
export const QUEUE_JOB_EXPIRE_MS  = parseInt(process.env.QUEUE_JOB_EXPIRE_MS || '604800000', 10);
export const QUEUE_JOB_EXPIRE_SEC = Math.round(QUEUE_JOB_EXPIRE_MS / 1000);
// Hard cap on jobs kept per state per queue. `age` alone does not stop a burst:
// thousands of jobs finishing within minutes are all "younger than the threshold".
export const QUEUE_JOB_MAX_COUNT  = parseInt(process.env.QUEUE_JOB_MAX_COUNT || '1000', 10);

/**
 * Shared job retention options for every BullMQ queue.
 * See 01-HOTFIX-LOG-LEAK.md §4 T5 (keepLogs) and T6 (removeOnComplete/removeOnFail).
 *
 * Applied via `defaultJobOptions` at all three queue creation sites:
 *   lib/queue/pipeline-queue.ts   getPipelineQueue()
 *   lib/queue/pipeline-queue.ts   getWorkflowStepsQueue()
 *   lib/queue/worker-group-router.ts  DEFAULT_JOB_OPTIONS (per worker-group queue)
 */
export function getQueueRetentionOptions() {
  return {
    removeOnComplete: { age: QUEUE_JOB_EXPIRE_SEC, count: QUEUE_JOB_MAX_COUNT },
    removeOnFail:     { age: QUEUE_JOB_EXPIRE_SEC, count: QUEUE_JOB_MAX_COUNT },
    keepLogs:         KEEP_JOB_LOGS,
  };
}

// ─── Queue backlog cleanup (scheduler) ────────────────────────────────────────
// The retention options above are frozen into each job at `add` time, so they only
// ever apply to NEW jobs. Two gaps remain, and the scheduler in
// lib/queue-cleanup.ts closes both:
//
//  1. Jobs added BEFORE that config existed carry `removeOnFail: false` forever.
//  2. BullMQ only trims a queue when a job finishes ON THAT QUEUE. A worker-group
//     queue that is no longer in use never trims itself — so the scheduler is a
//     PERMANENT component, not a one-off migration. See 03-AMENDMENTS-QUEUE-PLAN §4.
//
// The scheduler reuses QUEUE_JOB_EXPIRE_MS as the `grace` argument of
// queue.clean() — no separate age env.

/**
 * Master switch for the daily backlog scan.
 *
 * DEFAULTS TO `false` — opt-in, on purpose. This scan DELETES jobs and deletion has
 * no undo, so the safe default for a destructive operation is off.
 *
 * The first pass runs over months of accumulated jobs; queue.clean() is a Lua script
 * and therefore blocks Redis' single thread for the duration of each batch. Ops runs
 * that first pass in a controlled low-traffic window (BGSAVE first), then sets this
 * env to `true` for steady-state operation. See 03-AMENDMENTS-QUEUE-PLAN §8 (B3).
 *
 * Fail-safe rationale: if Ops forgets the env, the cost is "backlog not cleaned yet"
 * — visible, recoverable, and logged at boot. The inverse default would risk an
 * uncontrolled destructive scan starting 30s after a restart on a Redis that is
 * already under memory pressure. Plan §8.2 originally specified `true`; that predates
 * amendment B3 and the discovery that Redis was in an OOM crash loop.
 */
export const QUEUE_CLEANUP_SCHEDULE_ENABLED =
  (process.env.QUEUE_CLEANUP_SCHEDULE_ENABLED ?? 'false').toLowerCase() === 'true';

/**
 * Jobs removed per queue.clean() call. Deliberately small: each call is one Lua
 * script execution that blocks Redis, and a job with a large `:logs` list makes
 * that script expensive. 300 over 1000 is a latency trade, not a throughput one —
 * the loop repeats until the queue is clean either way.
 */
export const QUEUE_CLEANUP_BATCH_SIZE = parseInt(process.env.QUEUE_CLEANUP_BATCH_SIZE || '300', 10);

/** Pause between batches so Redis can serve normal traffic in between. */
export const QUEUE_CLEANUP_BATCH_DELAY_MS = parseInt(process.env.QUEUE_CLEANUP_BATCH_DELAY_MS || '1000', 10);

/**
 * Retro-trim pass: LTRIM the `:logs` list of jobs that are still INSIDE the age
 * window, without removing the jobs themselves.
 *
 * Needed because `keepLogs` is frozen at `add`: a job already in Redis from before
 * that setting existed has an uncapped log list, and queue.clean() only helps once
 * the job is old enough to delete. Until then its logs stay unbounded.
 *
 * Preferred over an Ops-run `UNLINK` on `bull:*:logs`: Job.clearLogs(N) keeps the
 * LAST N rows, so Bull Board can still triage the job, and it needs no production
 * shell access.
 *
 * Can be switched off once the pre-config backlog has aged out — from then on every
 * job caps its own log list at write time.
 */
export const QUEUE_LOG_TRIM_ENABLED =
  (process.env.QUEUE_LOG_TRIM_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * Upper bound on jobs inspected per queue per run by the retro-trim pass.
 * Each trim is its own LTRIM round-trip, so an unbounded pass over hundreds of
 * thousands of jobs would keep Redis busy far longer than the clean() pass.
 * 0 = no limit (only sensible for a controlled manual run).
 */
export const QUEUE_LOG_TRIM_MAX_JOBS = parseInt(process.env.QUEUE_LOG_TRIM_MAX_JOBS || '2000', 10);

// ─── Log redaction / truncation ───────────────────────────────────────────────
// See handover-report/DUImprovement/RedisLog/LOGGER_CONTENT_REDACTION_PLAN.md
// + 02-AMENDMENTS-LOGGER-PLAN.md.
//
// Read LIVE from process.env on every log line instead of frozen at import time.
// Two reasons: (1) operators can flip LOG_REDACT_MODE without a rebuild in the
// same way LOG_LEVEL already behaves per Logger instance; (2) it keeps the
// sanitizer unit-testable without module-registry gymnastics. The cost is a few
// parseInt calls per log line, which is noise next to JSON.stringify.

export const LOG_REDACT_MODE_DEFAULT = 'redacted';
/** Truncation threshold for string values inside `meta`. */
export const LOG_MAX_STRING_LEN_DEFAULT = 500;
/** Truncation threshold for `message` (amendment A2 — looser, it is diagnostic text). */
export const LOG_MAX_MESSAGE_LEN_DEFAULT = 2000;
export const LOG_SANITIZE_MAX_DEPTH_DEFAULT = 4;
/** Per-string ceiling for the stdout sink, even in raw mode. */
export const LOG_RAW_HARD_CAP_DEFAULT = 100_000;
/**
 * Whole-line ceiling for the `job.log()` → Redis sink (amendment A1).
 * Much lower than the stdout cap on purpose: stdout has external rotation,
 * the BullMQ `:logs` list has none — it only shrinks when the job is removed.
 */
export const LOG_JOBLOG_HARD_CAP_DEFAULT = 2000;

/**
 * Ghi PROMPT và OUTPUT của lời gọi LLM vào BullMQ `:logs` (Bull Board) để tra lỗi (ngoại lệ có kiểm soát của chính sách "job.log luôn bị cắt").
 * Mặc định TẮT: prompt chứa dữ liệu khách hàng (số định danh, tên, địa chỉ) và list `:logs` nằm trong RAM Redis, không xoay vòng, chỉ mất khi job bị xoá
 * (`QUEUE_JOB_EXPIRE_MS`, `QUEUE_JOB_MAX_COUNT`). Chỉ bật trên môi trường test/điều tra. Secret và base64 vẫn luôn bị che.
 */
export const LOG_JOB_LLM_IO_DEFAULT = false;
/** Trần ký tự cho MỖI dòng prompt/output khi bật `LOG_JOB_LLM_IO` (cao hơn `LOG_JOBLOG_HARD_CAP`; prompt precheck ~25.000 ký tự). */
export const LOG_JOB_LLM_IO_CAP_DEFAULT = 60_000;

export interface LogRedactionConfig {
  mode: 'redacted' | 'raw';
  maxStringLen: number;
  maxMessageLen: number;
  maxDepth: number;
  /** stdout, per string. */
  rawHardCap: number;
  /** job.log() → Redis, per whole line. */
  jobLogHardCap: number;
  /** Bật ghi prompt/output của LLM vào job.log() (xem `LOG_JOB_LLM_IO_DEFAULT`). */
  jobLlmIo: boolean;
  /** Trần ký tự mỗi dòng prompt/output LLM trong job.log(). */
  jobLlmIoCap: number;
}

function intEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getLogRedactionConfig(): LogRedactionConfig {
  const rawMode = (process.env.LOG_REDACT_MODE ?? LOG_REDACT_MODE_DEFAULT).toLowerCase();
  return {
    mode: rawMode === 'raw' ? 'raw' : 'redacted',
    maxStringLen: intEnv('LOG_MAX_STRING_LEN', LOG_MAX_STRING_LEN_DEFAULT),
    maxMessageLen: intEnv('LOG_MAX_MESSAGE_LEN', LOG_MAX_MESSAGE_LEN_DEFAULT),
    maxDepth: intEnv('LOG_SANITIZE_MAX_DEPTH', LOG_SANITIZE_MAX_DEPTH_DEFAULT),
    rawHardCap: intEnv('LOG_RAW_HARD_CAP', LOG_RAW_HARD_CAP_DEFAULT),
    jobLogHardCap: intEnv('LOG_JOBLOG_HARD_CAP', LOG_JOBLOG_HARD_CAP_DEFAULT),
    jobLlmIo: ['true', '1', 'yes', 'on'].includes((process.env.LOG_JOB_LLM_IO ?? String(LOG_JOB_LLM_IO_DEFAULT)).trim().toLowerCase()),
    jobLlmIoCap: Math.max(1, intEnv('LOG_JOB_LLM_IO_CAP', LOG_JOB_LLM_IO_CAP_DEFAULT)),
  };
}

// ─── Secrets / HashiCorp Vault ────────────────────────────────────────────────
// Outbound connector API keys (AI Hub / Agent Toolkit) are resolved at runtime
// from a secret provider instead of being stored recoverable in the DB.
//   SECRET_PROVIDER = 'vault' | 'dev'   (default: 'vault' if VAULT_ADDR set, else 'dev')
// Vault uses AppRole auth + KV v2.
//
// ONE unambiguous rule for operations: the connector's "Vault Secret Path" is the
// FULL KV path exactly as shown in the Vault UI (within the mount), optionally with
// a "<mount>:" prefix to target a different mount, and "#<field>" for the field.
// There is NO hidden path-prefix concatenation — what you type is what is read:
//   ${VAULT_ADDR}/v1/[<mount>|${VAULT_KV_MOUNT}]/data/<path>   (field default: api_key)
// Examples:
//   "eda/rpa/dugate/agent-toolkit#ext-doc-layout"  → secret/data/eda/rpa/dugate/agent-toolkit
//   "kv-aihub:eda/aihub/shared#api_key"            → kv-aihub/data/eda/aihub/shared
export const VAULT_ADDR = process.env.VAULT_ADDR ?? '';
export const SECRET_PROVIDER =
  process.env.SECRET_PROVIDER ?? (VAULT_ADDR ? 'vault' : 'dev');
export const VAULT_ROLE_ID = process.env.VAULT_ROLE_ID ?? '';
export const VAULT_SECRET_ID = process.env.VAULT_SECRET_ID ?? '';
// Default KV mount used when a connector path does not specify "<mount>:".
export const VAULT_KV_MOUNT = process.env.VAULT_KV_MOUNT ?? 'secret';
export const VAULT_NAMESPACE = process.env.VAULT_NAMESPACE ?? '';
// Cache the resolved secret VALUE for this long to avoid hitting Vault per request.
export const VAULT_SECRET_CACHE_TTL_MS = parseInt(process.env.VAULT_SECRET_CACHE_TTL_MS || '60000', 10);
// When Vault errors AFTER a value was cached, keep serving the stale value up to
// this long (soft outage tolerance) before failing closed. 0 = fail immediately on expiry.
export const VAULT_SECRET_STALE_MAX_MS = parseInt(process.env.VAULT_SECRET_STALE_MAX_MS || '600000', 10);
export const VAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.VAULT_REQUEST_TIMEOUT_MS || '5000', 10);
// Renew the AppRole token this many ms before its lease expiry.
export const VAULT_TOKEN_RENEW_SKEW_MS = parseInt(process.env.VAULT_TOKEN_RENEW_SKEW_MS || '30000', 10);

// ─── Rate limiting ────────────────────────────────────────────────────────────

export const RATE_LIMIT_API_KEY_PER_MIN = parseInt(process.env.RATE_LIMIT_API_KEY || '100', 10);
export const RATE_LIMIT_IP_PER_MIN = parseInt(process.env.RATE_LIMIT_IP || '30', 10);

// ─── Model pricing (USD per 1M tokens) ───────────────────────────────────────
// Used for cost tracking in Phase 6. Update as provider pricing changes.

export interface ModelPricing {
  input: number;   // USD per 1M input tokens
  output: number;  // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Google Gemini — on-demand pricing (June 2026, Google Cloud / Vertex AI)
  'gemini-1.5-flash':   { input: 0.075,  output: 0.30  },
  'gemini-1.5-pro':     { input: 3.50,   output: 10.50 },
  'gemini-2.0-flash':   { input: 0.10,   output: 0.40  },
  'gemini-2.5-flash':   { input: 0.15,   output: 0.60  },
  'gemini-2.5-pro':     { input: 1.25,   output: 10.00 },
  'gemini-3.5-flash':   { input: 1.50,   output: 9.00  },
  // OpenAI — on-demand pricing (June 2026)
  'gpt-4o':             { input: 2.50,   output: 10.00 },
  'gpt-4o-mini':        { input: 0.15,   output: 0.60  },
  'gpt-3.5-turbo':      { input: 0.50,   output: 1.50  },
};

/**
 * Calculate cost in USD for a given model and token counts.
 * Returns 0 if the model is not in the pricing table.
 */
export function calculateCostUsd(
  modelUsed: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Normalize: match prefix (e.g. "ext:gemini-1.5-flash" → "gemini-1.5-flash")
  const normalized = modelUsed.replace(/^ext:/, '').replace(/^internal:/, '');
  const pricing = MODEL_PRICING[normalized];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
