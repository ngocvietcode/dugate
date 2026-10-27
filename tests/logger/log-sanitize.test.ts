// tests/logger/log-sanitize.test.ts
// Unit tests for the two-layer log sanitizer.
// Plan: LOGGER_CONTENT_REDACTION_PLAN.md §6 / T5.1–T5.2
//       02-AMENDMENTS-LOGGER-PLAN.md §4 (A2), §9 (new tests)

import {
  CIRCULAR,
  REDACTED,
  SANITIZE_ERROR,
  UNREADABLE,
  type SanitizeOptions,
  capLogLine,
  isContentKey,
  isPreservedKey,
  isSecretKey,
  safeJsonStringify,
  sanitizeForLog,
  sanitizeLogError,
  sanitizeLogMessage,
  sanitizeLogMeta,
} from '@/lib/log-sanitize';

const REDACTED_OPTS: SanitizeOptions = {
  mode: 'redacted',
  maxStringLen: 500,
  maxMessageLen: 2000,
  maxDepth: 4,
  hardCap: 100_000,
};

const RAW_OPTS: SanitizeOptions = { ...REDACTED_OPTS, mode: 'raw' };

const BOTH_MODES: Array<[string, SanitizeOptions]> = [
  ['redacted', REDACTED_OPTS],
  ['raw', RAW_OPTS],
];

describe('key classification', () => {
  it('treats credential-shaped keys as SECRET', () => {
    for (const key of [
      'api_key', 'apiKey', 'APIKEY', 'authorization', 'auth', 'access_token',
      'refresh_token', 'token', 'secret', 'client_secret', 'authSecret',
      'vaultSecretPath', 'keyHash', 'password', 'credential', 'cookie',
    ]) {
      expect(isSecretKey(key)).toBe(true);
    }
  });

  it('never classifies a trace identifier as SECRET, including apiKeyId', () => {
    for (const key of ['correlationId', 'operationId', 'apiKeyId', 'jobId', 'jobName', 'queue', 'errorCode']) {
      expect(isPreservedKey(key)).toBe(true);
      expect(isSecretKey(key)).toBe(false);
      expect(isContentKey(key)).toBe(false);
    }
  });

  it('treats payload-shaped keys as CONTENT', () => {
    for (const key of [
      'content', 'prompt', 'body', 'jsonBody', 'response', 'responseJson',
      'base64', 'curl', 'input_content', 'ocr_texts', 'documentText',
      'content_preview', 'extractedData',
    ]) {
      expect(isContentKey(key)).toBe(true);
    }
  });

  it('does NOT treat a MEASURE of content as CONTENT', () => {
    // These are exactly the log lines the "log the measure, not the payload"
    // convention produces (external-api.ts, lc-checker.ts). Redacting them would
    // destroy the diagnostics the plan wants to keep.
    for (const key of ['contentLength', 'contentChars', 'outputChars', 'bodyBytes', 'contentType', 'promptLen']) {
      expect(isContentKey(key)).toBe(false);
    }
  });
});

describe('SECRET layer — applies in EVERY mode (no exception)', () => {
  it.each(BOTH_MODES)('redacts secret-keyed values (%s mode)', (_name, opts) => {
    const out = sanitizeForLog(
      { api_key: 'sk-live-abcdef', authSecret: 'hunter2', keyHash: 'deadbeef', vaultSecretPath: 'kv:eda/x#api_key' },
      opts,
    ) as Record<string, unknown>;

    expect(out.api_key).toBe(REDACTED);
    expect(out.authSecret).toBe(REDACTED);
    expect(out.keyHash).toBe(REDACTED);
    expect(out.vaultSecretPath).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain('sk-live-abcdef');
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });

  it.each(BOTH_MODES)('redacts credential shapes inside free text (%s mode)', (_name, opts) => {
    const message = 'POST failed {"api_key":"sk-live-secret-value","model":"gemini"} header=Bearer eyJhbGciOiJIUzI1';
    const out = sanitizeLogMessage(message, opts);

    expect(out).not.toContain('sk-live-secret-value');
    expect(out).not.toContain('eyJhbGciOiJIUzI1');
    expect(out).toContain('"***"');
    expect(out).toMatch(/Bearer \*\*\*/i);
    // Non-secret context survives — this is diagnosis, not noise.
    expect(out).toContain('gemini');
  });

  it.each(BOTH_MODES)('masks credentials embedded in a URL authority (%s mode)', (_name, opts) => {
    const out = sanitizeLogMessage('[Worker] Redis: redis://:p@ssw0rd@redis-host:6379/0', opts);
    expect(out).not.toContain('p@ssw0rd');
    expect(out).toContain('redis://***@redis-host:6379/0');
  });

  it.each(BOTH_MODES)('redacts a secret-keyed OBJECT rather than walking into it (%s mode)', (_name, opts) => {
    const out = sanitizeForLog({ credential: { user: 'svc', password: 'p' } }, opts) as Record<string, unknown>;
    expect(out.credential).toBe(REDACTED);
  });

  it('keeps token COUNTS — they are numbers, not credentials', () => {
    const out = sanitizeForLog({ inputTokens: 1234, outputTokens: 56, totalTokens: 1290 }, REDACTED_OPTS) as Record<string, unknown>;
    expect(out).toEqual({ inputTokens: 1234, outputTokens: 56, totalTokens: 1290 });
  });
});

describe('CONTENT layer — redacted mode only', () => {
  it('truncates a CONTENT-keyed value at LOG_MAX_STRING_LEN', () => {
    const out = sanitizeForLog({ content: 'x'.repeat(1500) }, REDACTED_OPTS) as Record<string, string>;
    expect(out.content).toContain('(content truncated, len=1500)');
    expect(out.content.startsWith('x'.repeat(500))).toBe(true);
    expect(out.content.startsWith('x'.repeat(501))).toBe(false);
  });

  it('keeps a CONTENT-keyed value intact in raw mode', () => {
    const content = 'x'.repeat(1500);
    const out = sanitizeForLog({ content }, RAW_OPTS) as Record<string, string>;
    expect(out.content).toBe(content);
  });

  it('truncates ordinary long strings too (rule 3, not only by key)', () => {
    const out = sanitizeForLog({ note: 'y'.repeat(1500) }, REDACTED_OPTS) as Record<string, string>;
    expect(out.note).toContain('(truncated, len=1500)');
  });

  it('replaces inline base64 attachments outright', () => {
    const body = `{"file":"data:application/pdf;base64,${'QUJD'.repeat(400)}"}`;
    const out = sanitizeLogMessage(body, REDACTED_OPTS);
    expect(out).toContain('<REDACTED_BASE64 chars=');
    expect(out).not.toContain('QUJDQUJDQUJD');
  });

  it('leaves short, non-sensitive values byte-for-byte intact', () => {
    const meta = { fileName: 'BCTC.pdf', pages: 12, ok: true, ratio: 0.97 };
    expect(sanitizeForLog(meta, REDACTED_OPTS)).toEqual(meta);
  });
});

describe('message vs meta thresholds (amendment A2)', () => {
  it('does NOT truncate a 1500-char message (under LOG_MAX_MESSAGE_LEN=2000)', () => {
    const message = 'a'.repeat(1500);
    expect(sanitizeLogMessage(message, REDACTED_OPTS)).toBe(message);
  });

  it('truncates a 2500-char message at LOG_MAX_MESSAGE_LEN', () => {
    const out = sanitizeLogMessage('a'.repeat(2500), REDACTED_OPTS);
    expect(out).toContain('(truncated, len=2500)');
    expect(out.startsWith('a'.repeat(2000))).toBe(true);
    expect(out.startsWith('a'.repeat(2001))).toBe(false);
  });

  it('truncates content interpolated into the MESSAGE, which a key-based rule cannot see', () => {
    // The real bloat shape: logger.info(`... ${result.content}`)
    const out = sanitizeLogMessage(`[WORKFLOW] Step 1 raw response:\n${'Z'.repeat(50_000)}`, REDACTED_OPTS);
    expect(out.length).toBeLessThan(2100);
    expect(out).toContain('(truncated, len=');
  });
});

describe('structure limits', () => {
  it('stops at LOG_SANITIZE_MAX_DEPTH', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: 'too deep' } } } } };
    const out = sanitizeForLog(deep, REDACTED_OPTS) as any;
    expect(out.l1.l2.l3.l4).toBe('[Object]');
  });

  it('marks circular references instead of hanging', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    const out = sanitizeForLog(node, REDACTED_OPTS) as Record<string, unknown>;
    expect(out.name).toBe('root');
    expect(out.self).toBe(CIRCULAR);
  });

  it('summarizes binary payloads instead of serializing them', () => {
    const out = sanitizeForLog({ buf: Buffer.alloc(4096) }, RAW_OPTS) as Record<string, string>;
    expect(out.buf).toBe('<binary 4096 bytes>');
  });

  it('enforces the hard cap in raw mode, marker included', () => {
    const opts: SanitizeOptions = { ...RAW_OPTS, hardCap: 1000 };
    const out = sanitizeForLog({ content: 'x'.repeat(100_000) }, opts) as Record<string, string>;
    expect(out.content.length).toBeLessThanOrEqual(1000);
    expect(out.content).toContain('(capped, len=100000)');
  });

  it('capLogLine never exceeds the cap', () => {
    expect(capLogLine('q'.repeat(10_000), 2000).length).toBeLessThanOrEqual(2000);
    expect(capLogLine('short', 2000)).toBe('short');
    expect(capLogLine('q'.repeat(10_000), 0).length).toBe(10_000); // 0 = disabled
  });
});

// ─── THE trap: sanitize must never throw ──────────────────────────────────────
// Logger.write() runs inside catch blocks all over the pipeline. A sanitizer that
// throws replaces the original error with its own and can take the worker down.
// Every case below must degrade to a placeholder — never to the raw value, and
// never to an exception.
describe('never throws, never fails open', () => {
  it('survives a getter that throws', () => {
    const hostile = {
      ok: 'visible',
      get boom(): string { throw new Error('getter exploded'); },
    };
    let out: unknown;
    expect(() => { out = sanitizeForLog(hostile, REDACTED_OPTS); }).not.toThrow();
    expect((out as Record<string, unknown>).ok).toBe('visible');
    expect((out as Record<string, unknown>).boom).toBe(UNREADABLE);
  });

  it('survives BigInt (which JSON.stringify refuses)', () => {
    const out = sanitizeForLog({ big: BigInt('9007199254740993') }, REDACTED_OPTS);
    expect(() => JSON.stringify(out)).not.toThrow();
    expect((out as Record<string, unknown>).big).toBe('9007199254740993n');
  });

  it('survives Symbol values', () => {
    const out = sanitizeForLog({ sym: Symbol('marker') }, REDACTED_OPTS) as Record<string, string>;
    expect(out.sym).toContain('Symbol(marker)');
  });

  it('survives a Proxy with a hostile ownKeys trap', () => {
    const hostile = new Proxy({}, {
      ownKeys() { throw new Error('ownKeys exploded'); },
    });
    let out: unknown;
    expect(() => { out = sanitizeForLog({ hostile }, REDACTED_OPTS); }).not.toThrow();
    expect((out as Record<string, unknown>).hostile).toBe(UNREADABLE);
  });

  it('survives a revoked Proxy', () => {
    const revocable = Proxy.revocable({ a: 1 }, {});
    revocable.revoke();
    let out: unknown;
    expect(() => { out = sanitizeForLog({ dead: revocable.proxy }, REDACTED_OPTS); }).not.toThrow();
    expect([UNREADABLE, SANITIZE_ERROR]).toContain((out as Record<string, unknown>).dead);
  });

  it('survives a poisoned toJSON without leaking the object', () => {
    const hostile = { data: 'plain', toJSON() { throw new Error('toJSON exploded'); } };
    expect(() => safeJsonStringify(sanitizeForLog(hostile, REDACTED_OPTS))).not.toThrow();
  });

  it('degrades a hostile meta bag to an object, never to a spreadable string', () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error('nope'); } });
    const out = sanitizeLogMeta(hostile as Record<string, unknown>, REDACTED_OPTS);
    expect(typeof out).toBe('object');
    expect(Array.isArray(out)).toBe(false);
  });

  it('sanitizes an Error without losing name/message, and keeps the stack on stdout budget', () => {
    const err = new Error('provider rejected: api_key=sk-live-leak');
    const out = sanitizeLogError(err, REDACTED_OPTS) as { name: string; message: string; stack?: string };
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain('sk-live-leak');
    expect(out.stack).toBeDefined();
  });

  it('sanitizes a non-Error throwable', () => {
    expect(sanitizeLogError('boom', REDACTED_OPTS)).toBe('boom');
    expect(sanitizeLogError({ code: 'E_X' }, REDACTED_OPTS)).toEqual({ code: 'E_X' });
  });
});
