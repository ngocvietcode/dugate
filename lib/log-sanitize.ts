// lib/log-sanitize.ts
// Central log sanitizer. Two INDEPENDENT layers:
//
//   SECRET layer  — ALWAYS runs. Every mode, every level, every sink. No exception.
//   CONTENT layer — runs only in 'redacted' mode (Logger.write decides the mode).
//
// ─── HARD CONTRACT: NOTHING EXPORTED FROM THIS FILE MAY EVER THROW ───────────
// Logger.write() is called from everywhere in the pipeline, including from INSIDE
// catch blocks. A sanitizer that throws would (a) replace the original error with
// its own, hiding the real failure, and (b) potentially crash the worker while it
// is already handling a failure. Hostile shapes are routine here: circular
// references, getters that throw, BigInt, Symbol, Proxy, revoked Proxy, objects
// with a poisoned `Object.keys`.
//
// Therefore every public entry point funnels through neverThrow(), and the
// fallback is ALWAYS a placeholder — NEVER the original unfiltered value. Failing
// open would turn a sanitizer bug into a data leak.

export type LogRedactMode = 'redacted' | 'raw';

/** Emitted when sanitization itself failed. Never the raw value. */
export const SANITIZE_ERROR = '<SANITIZE_ERROR>';
/** A property existed but could not be read (throwing getter, revoked Proxy…). */
export const UNREADABLE = '<UNREADABLE>';
/** Reference already visited on this walk. */
export const CIRCULAR = '<CIRCULAR>';
/** A SECRET-classified value. */
export const REDACTED = '<REDACTED>';

export interface SanitizeOptions {
  /** 'redacted' = apply the CONTENT layer. 'raw' = CONTENT kept (SECRET still redacted). */
  mode: LogRedactMode;
  /** Truncation threshold for string values inside `meta` / context. */
  maxStringLen: number;
  /** Truncation threshold for `message` and for error message/stack (looser — diagnostic text). */
  maxMessageLen: number;
  /** Max recursion depth when walking `meta`. */
  maxDepth: number;
  /** Absolute per-string ceiling, applied in BOTH modes. 0 = off. */
  hardCap: number;
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/**
 * Credential-shaped `key: value` / `key=value` pairs in free-form text.
 *
 * Moved here from `lib/pipelines/processors/http-client.ts` (plan T3.2) so the
 * logger and `summarizeErrorBody()` share ONE definition.
 *
 * NOTE: these are /g regexes. Only ever use them with `String.prototype.replace`,
 * which resets `lastIndex`. Never with `.test()` — that is stateful and would
 * silently skip every other match.
 */
export const SECRET_KEY_PATTERN =
  /("?\b(?:api[_-]?key|apikey|authorization|auth|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|credential)\b"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi;

/** `Bearer <token>` / `Basic <token>` appearing anywhere in free-form text. */
export const BEARER_PATTERN = /\b(bearer|basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi;

/**
 * Credentials embedded in a URL authority: `redis://user:pass@host`, `https://tok@h`.
 *
 * `[^\s/?#]*` is greedy but cannot leave the authority section, so it collapses up
 * to the LAST '@' before path/query — which matters for passwords containing a
 * literal '@'. This is what keeps `REDIS_URL` out of system logs (plan §1.4).
 */
export const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;

/** Inline base64 attachments — the single largest log-bloat source (AIHub bodies). */
export const BASE64_DATA_URL_PATTERN =
  /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{64,}/gi;

// ─── Key classification ───────────────────────────────────────────────────────

/**
 * Trace identifiers. Never redacted, never truncated — they are how an operator
 * correlates a log line to an operation. `apikeyid` is listed explicitly because
 * it would otherwise match the SECRET pattern (`apikey`) even though it is an ID,
 * not a key. See 00-MASTER-OVERVIEW §9 / amendment §10.
 */
const PRESERVED_KEYS = new Set([
  'timestamp', 'level', 'service',
  'correlationid', 'operationid', 'suboperationid', 'subopid', 'parentoperationid',
  'apikeyid', 'jobid', 'jobname', 'queue', 'queuename', 'errorcode',
]);

/** Substrings that mark a key as SECRET. Matched against the normalized key. */
const SECRET_KEY_NAME =
  /(apikey|authorization|^auth$|accesstoken|refreshtoken|idtoken|bearer|token|secret|password|passwd|credential|keyhash|privatekey|cookie|signature)/;

/** Tokens that mark a key as CONTENT (prompt / document text / response body…). */
const CONTENT_TOKENS = new Set([
  'content', 'contents', 'prompt', 'prompts', 'body', 'response', 'responses',
  'raw', 'rawtext', 'rawresponse', 'base64', 'dataurl', 'curl',
  'ocrtext', 'ocrtexts', 'documenttext', 'text', 'texts', 'payload',
  'html', 'markdown', 'answer', 'completion', 'transcript', 'excerpt',
  'extracteddata', 'stepsresult',
]);

/**
 * When one of these is the LAST token, the key describes a MEASUREMENT of content
 * rather than the content itself: `contentLength`, `outputChars`, `bodyBytes`,
 * `contentType`. Those are exactly the log lines we want to keep — the whole point
 * of the "log the measure, not the payload" convention already used by
 * `lc-checker.ts` / `external-api.ts`.
 */
const MEASURE_TOKENS = new Set([
  'length', 'len', 'chars', 'char', 'bytes', 'byte', 'size', 'count', 'lines',
  'ratio', 'percent', 'index', 'id', 'type', 'encoding', 'format', 'mode', 'ms',
]);

/** Lowercase, strip separators: `api_key` / `apiKey` / `API-KEY` → `apikey`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split a key into lowercase tokens: `jsonBody` → ['json','body']. */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export function isPreservedKey(key: string): boolean {
  return PRESERVED_KEYS.has(normalizeKey(key));
}

export function isSecretKey(key: string): boolean {
  if (isPreservedKey(key)) return false;
  return SECRET_KEY_NAME.test(normalizeKey(key));
}

export function isContentKey(key: string): boolean {
  if (isPreservedKey(key)) return false;
  const tokens = keyTokens(key);
  if (tokens.length === 0) return false;
  if (MEASURE_TOKENS.has(tokens[tokens.length - 1])) return false;
  return tokens.some((token) => CONTENT_TOKENS.has(token))
    || CONTENT_TOKENS.has(normalizeKey(key));
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

/** SECRET layer for free-form text. Runs in every mode. */
export function redactSecretsInText(text: string): string {
  return text
    .replace(SECRET_KEY_PATTERN, '$1"***"')
    .replace(BEARER_PATTERN, '$1 ***')
    .replace(URL_CREDENTIALS_PATTERN, '$1***@');
}

/** CONTENT layer, part 1: kill inline base64 attachments outright. */
function redactBase64InText(text: string): string {
  return text.replace(BASE64_DATA_URL_PATTERN, (match) => `<REDACTED_BASE64 chars=${match.length}>`);
}

function truncate(value: string, max: number, label: string): string {
  if (max <= 0 || value.length <= max) return value;
  return `${value.slice(0, max)}…(${label}, len=${value.length})`;
}

/**
 * Absolute ceiling. Unlike truncate(), the RESULT is guaranteed to be `<= cap`
 * (the marker is counted), because this is the guard that bounds what reaches a
 * sink with no rotation.
 */
export function capLogLine(line: string, cap: number): string {
  if (cap <= 0 || line.length <= cap) return line;
  const marker = `…(capped, len=${line.length})`;
  return `${line.slice(0, Math.max(0, cap - marker.length))}${marker}`;
}

function sanitizeStringValue(
  raw: string,
  opts: SanitizeOptions,
  maxLen: number,
  contentKey: boolean,
): string {
  let out = redactSecretsInText(raw);
  if (opts.mode === 'redacted') {
    out = redactBase64InText(out);
    out = truncate(out, maxLen, contentKey ? 'content truncated' : 'truncated');
  }
  return capLogLine(out, opts.hardCap);
}

// ─── Recursive walk (may throw — callers must wrap) ───────────────────────────

function describeBinary(value: object): string | null {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `<binary ${value.length} bytes>`;
  }
  if (value instanceof ArrayBuffer) return `<binary ${value.byteLength} bytes>`;
  if (ArrayBuffer.isView(value)) return `<binary ${value.byteLength} bytes>`;
  return null;
}

function walk(
  value: unknown,
  opts: SanitizeOptions,
  depth: number,
  seen: WeakSet<object>,
  maxLen: number,
  contentKey: boolean,
): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return sanitizeStringValue(value, opts, maxLen, contentKey);
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      // JSON.stringify throws on BigInt — convert before it reaches the encoder.
      return `${value.toString()}n`;
    case 'symbol':
      // `String(sym)` is safe; `sym + ''` throws. Use the explicit call.
      return value.toString();
    case 'function':
      return `<function ${(value as { name?: string }).name || 'anonymous'}>`;
    default:
      break;
  }

  const obj = value as object;

  if (seen.has(obj)) return CIRCULAR;

  const binary = describeBinary(obj);
  if (binary) return binary;

  if (obj instanceof Date) {
    const iso = Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
    return iso;
  }
  if (obj instanceof Map) return `<Map size=${obj.size}>`;
  if (obj instanceof Set) return `<Set size=${obj.size}>`;
  if (obj instanceof RegExp) return sanitizeStringValue(obj.toString(), opts, maxLen, contentKey);

  if (obj instanceof Error) {
    seen.add(obj);
    return {
      name: obj.name,
      message: sanitizeStringValue(String(obj.message ?? ''), opts, opts.maxMessageLen, false),
      stack: obj.stack
        ? sanitizeStringValue(String(obj.stack), opts, opts.maxMessageLen, false)
        : undefined,
    };
  }

  if (depth >= opts.maxDepth) return Array.isArray(obj) ? '[Array]' : '[Object]';

  seen.add(obj);

  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    for (let i = 0; i < obj.length; i += 1) {
      let item: unknown;
      try {
        item = obj[i];
      } catch {
        out.push(UNREADABLE);
        continue;
      }
      try {
        out.push(walk(item, opts, depth + 1, seen, maxLen, contentKey));
      } catch {
        out.push(SANITIZE_ERROR);
      }
    }
    return out;
  }

  // Object.keys() can throw on a Proxy with a hostile ownKeys trap (or a revoked one).
  let keys: string[];
  try {
    keys = Object.keys(obj);
  } catch {
    return UNREADABLE;
  }

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    let child: unknown;
    try {
      child = (obj as Record<string, unknown>)[key];
    } catch {
      // A getter threw. Record the shape, drop the value.
      out[key] = UNREADABLE;
      continue;
    }

    try {
      if (isPreservedKey(key)) {
        // Trace identifiers pass through untouched — but only primitives; an
        // object parked under a preserved name still gets walked.
        out[key] = typeof child === 'object' && child !== null
          ? walk(child, opts, depth + 1, seen, maxLen, false)
          : child;
        continue;
      }
      if (isSecretKey(key) && typeof child !== 'number' && typeof child !== 'boolean') {
        // SECRET: no mode, level or sink can unlock this.
        out[key] = REDACTED;
        continue;
      }
      out[key] = walk(child, opts, depth + 1, seen, maxLen, contentKey || isContentKey(key));
    } catch {
      out[key] = SANITIZE_ERROR;
    }
  }
  return out;
}

// ─── Public API (never throws) ────────────────────────────────────────────────

function neverThrow<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Sanitize an arbitrary value for logging.
 * Guaranteed not to throw; degrades to {@link SANITIZE_ERROR}.
 */
export function sanitizeForLog(value: unknown, opts: SanitizeOptions): unknown {
  return neverThrow(
    () => walk(value, opts, 0, new WeakSet<object>(), opts.maxStringLen, false),
    SANITIZE_ERROR,
  );
}

/**
 * Sanitize a log `message`.
 *
 * Amendment A2: truncation applies to `message` too, not only to values inside
 * `meta`. The real bloat source is template interpolation
 * (`logger.info(\`… ${result.content}\`)`), which a key-based rule cannot see.
 * `message` gets the looser {@link SanitizeOptions.maxMessageLen} because it is
 * hand-written diagnostic text, not payload.
 */
export function sanitizeLogMessage(message: unknown, opts: SanitizeOptions): string {
  return neverThrow(() => {
    const text = typeof message === 'string' ? message : String(message);
    return sanitizeStringValue(text, opts, opts.maxMessageLen, false);
  }, SANITIZE_ERROR);
}

/**
 * Sanitize a `meta` bag. ALWAYS returns a plain object so the caller can spread
 * it — a bare placeholder string would otherwise spread into single characters.
 */
export function sanitizeLogMeta(
  meta: Record<string, unknown> | undefined,
  opts: SanitizeOptions,
): Record<string, unknown> {
  if (!meta) return {};
  return neverThrow(() => {
    const out = walk(meta, opts, 0, new WeakSet<object>(), opts.maxStringLen, false);
    return out && typeof out === 'object' && !Array.isArray(out)
      ? (out as Record<string, unknown>)
      : { meta: out };
  }, { meta: SANITIZE_ERROR });
}

/** Sanitize a thrown value into a log-safe shape (object for Errors, string otherwise). */
export function sanitizeLogError(error: unknown, opts: SanitizeOptions): unknown {
  return neverThrow(() => {
    if (error instanceof Error) {
      return walk(error, opts, 0, new WeakSet<object>(), opts.maxMessageLen, false);
    }
    if (typeof error === 'object' && error !== null) {
      return walk(error, opts, 0, new WeakSet<object>(), opts.maxStringLen, false);
    }
    return sanitizeStringValue(String(error), opts, opts.maxMessageLen, false);
  }, SANITIZE_ERROR);
}

/**
 * Short, single-line error text for the Bull Board sink. Mirrors the previous
 * `String(error)` shape but redacted and bounded, and WITHOUT the stack — a stack
 * per log row in Redis is pure bloat and is already on stdout.
 */
export function sanitizeErrorForJobLog(error: unknown, opts: SanitizeOptions): string {
  return neverThrow(() => {
    const text = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return sanitizeStringValue(text, opts, opts.maxStringLen, false);
  }, SANITIZE_ERROR);
}

/** JSON.stringify that cannot throw (cycles, BigInt, hostile toJSON). */
export function safeJsonStringify(value: unknown): string {
  return neverThrow(() => JSON.stringify(value) ?? String(value), SANITIZE_ERROR);
}
