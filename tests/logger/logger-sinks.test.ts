// tests/logger/logger-sinks.test.ts
// Integration tests for Logger's per-SINK redaction policy.
//
// THE KEYSTONE TEST of amendment A1 lives here: logger.error() with long content
// must leave stdout FULL but job.log() CUT. stdout has external rotation; the
// BullMQ `bull:<queue>:<jobId>:logs` list in Redis has none.

import type { Job } from 'bullmq';
import { Logger } from '@/lib/logger';
import { REDACTED } from '@/lib/log-sanitize';

const LOG_ENVS = [
  'LOG_LEVEL', 'LOG_FORMAT', 'LOG_REDACT_MODE',
  'LOG_MAX_STRING_LEN', 'LOG_MAX_MESSAGE_LEN', 'LOG_SANITIZE_MAX_DEPTH',
  'LOG_RAW_HARD_CAP', 'LOG_JOBLOG_HARD_CAP',
] as const;

const savedEnv: Record<string, string | undefined> = {};

let stdout: jest.SpyInstance;
let stderr: jest.SpyInstance;

/** A stand-in for the BullMQ job whose `log()` writes into Redis. */
function makeJob() {
  const lines: string[] = [];
  const job = {
    log: jest.fn(async (row: string) => { lines.push(row); return lines.length; }),
  };
  return { job: job as unknown as Job<any, any, any>, lines };
}

/** Everything written to stdout+stderr, as parsed JSON log payloads. */
function jsonLines(): Array<Record<string, any>> {
  return [...stdout.mock.calls, ...stderr.mock.calls]
    .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
    .filter((v): v is Record<string, any> => v !== null);
}

beforeEach(() => {
  for (const key of LOG_ENVS) savedEnv[key] = process.env[key];
  process.env.LOG_LEVEL = 'DEBUG';
  process.env.LOG_FORMAT = 'json';
  delete process.env.LOG_REDACT_MODE;
  delete process.env.LOG_MAX_STRING_LEN;
  delete process.env.LOG_MAX_MESSAGE_LEN;
  delete process.env.LOG_SANITIZE_MAX_DEPTH;
  delete process.env.LOG_RAW_HARD_CAP;
  delete process.env.LOG_JOBLOG_HARD_CAP;
  stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
  stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  for (const key of LOG_ENVS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ─── A1 keystone ──────────────────────────────────────────────────────────────

describe('A1 — job.log() is ALWAYS redacted, stdout follows the level', () => {
  const LONG = 'C'.repeat(50_000);

  it('logger.error(): stdout keeps FULL content, job.log() is cut at LOG_JOBLOG_HARD_CAP', () => {
    const { job, lines } = makeJob();
    new Logger({ operationId: 'op-1' }, job).error(`AI response dump:\n${LONG}`);

    const payload = jsonLines()[0];
    expect(payload.message).toContain(LONG);          // stdout: full, for debugging
    expect(payload.message.length).toBeGreaterThan(50_000);

    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThanOrEqual(2000); // Redis: bounded
    expect(lines[0]).not.toContain('C'.repeat(2100));
    expect(lines[0]).toContain('(truncated, len=');
  });

  it('applies the same cut to error-level META, not just the message', () => {
    const { job, lines } = makeJob();
    new Logger({}, job).error('extract failed', { content: LONG, jsonBody: LONG });

    const payload = jsonLines()[0];
    expect(payload.content).toBe(LONG);                // stdout raw at ERROR
    expect(lines[0].length).toBeLessThanOrEqual(2000);
  });

  it('caps the job.log() line even when LOG_REDACT_MODE=raw is forced globally', () => {
    process.env.LOG_REDACT_MODE = 'raw';
    const { job, lines } = makeJob();
    new Logger({}, job).info(`dump ${LONG}`);

    expect(jsonLines()[0].message).toContain(LONG);
    expect(lines[0].length).toBeLessThanOrEqual(2000);
  });

  it('caps the job.log() line even through logger.raw()', () => {
    const { job, lines } = makeJob();
    new Logger({}, job).raw().info(`dump ${LONG}`);

    expect(jsonLines()[0].message).toContain(LONG);
    expect(lines[0].length).toBeLessThanOrEqual(2000);
  });

  it('honours a custom LOG_JOBLOG_HARD_CAP', () => {
    process.env.LOG_JOBLOG_HARD_CAP = '300';
    const { job, lines } = makeJob();
    new Logger({}, job).error(`dump ${LONG}`);
    expect(lines[0].length).toBeLessThanOrEqual(300);
  });

  it('keeps a short line untouched in both sinks', () => {
    const { job, lines } = makeJob();
    new Logger({ correlationId: 'corr-9' }, job).info('[WORKFLOW] Step 1/4: Classify 3 file(s)');

    expect(jsonLines()[0].message).toBe('[WORKFLOW] Step 1/4: Classify 3 file(s)');
    expect(lines[0]).toBe('[INFO] [WORKFLOW] Step 1/4: Classify 3 file(s)');
  });
});

// ─── Mode derived from level ───────────────────────────────────────────────────

describe('stdout CONTENT mode is derived from the level', () => {
  it('redacts CONTENT at debug/info/warn', () => {
    const logger = new Logger({});
    logger.debug('d', { content: 'x'.repeat(1500) });
    logger.info('i', { content: 'x'.repeat(1500) });
    logger.warn('w', { content: 'x'.repeat(1500) });

    for (const payload of jsonLines()) {
      expect(payload.content).toContain('(content truncated, len=1500)');
    }
  });

  it('shows full CONTENT at error', () => {
    new Logger({}).error('e', { content: 'x'.repeat(1500) });
    expect(jsonLines()[0].content).toBe('x'.repeat(1500));
  });

  it('LOG_REDACT_MODE=raw lifts CONTENT redaction at every level', () => {
    process.env.LOG_REDACT_MODE = 'raw';
    new Logger({}).info('i', { content: 'x'.repeat(1500) });
    expect(jsonLines()[0].content).toBe('x'.repeat(1500));
  });

  it('logger.raw() lifts CONTENT redaction for one call site', () => {
    new Logger({}).raw().info('i', { content: 'x'.repeat(1500) });
    expect(jsonLines()[0].content).toBe('x'.repeat(1500));
  });

  it('child() inherits the raw flag and the context', () => {
    new Logger({ service: 'svc' }).raw().child({ operationId: 'op-2' })
      .info('i', { content: 'x'.repeat(1500) });

    const payload = jsonLines()[0];
    expect(payload.service).toBe('svc');
    expect(payload.operationId).toBe('op-2');
    expect(payload.content).toBe('x'.repeat(1500));
  });
});

// ─── SECRET has no exception anywhere ─────────────────────────────────────────

describe('SECRET redaction has no escape hatch', () => {
  const cases: Array<[string, () => Logger]> = [
    ['info', () => new Logger({})],
    ['error', () => new Logger({})],
    ['raw().info', () => new Logger({}).raw()],
  ];

  it.each(cases)('hides secrets on stdout via %s', (kind, build) => {
    const logger = build();
    const meta = { api_key: 'sk-live-LEAK', model: 'gemini-2.5-pro' };
    if (kind === 'error') logger.error('m', meta); else logger.info('m', meta);

    const payload = jsonLines()[0];
    expect(payload.api_key).toBe(REDACTED);
    expect(JSON.stringify(payload)).not.toContain('sk-live-LEAK');
    expect(payload.model).toBe('gemini-2.5-pro');
  });

  it('hides secrets in job.log() too', () => {
    const { job, lines } = makeJob();
    new Logger({}, job).error('auth failed', { authSecret: 'hunter2' });
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).toContain(REDACTED);
  });

  it('hides a credential reflected in an error stack, at error level', () => {
    const err = new Error('provider said: api_key=sk-live-STACKLEAK');
    new Logger({}).error('call failed', undefined, err);

    const serialized = JSON.stringify(jsonLines()[0]);
    expect(serialized).not.toContain('sk-live-STACKLEAK');
  });

  it('masks the Redis URL password in a system log', () => {
    // worker.ts logs through `new Logger(...).raw()` — full CONTENT, SECRET still on.
    new Logger({ service: 'worker' }).raw().info('[Worker] Redis: redis://:s3cr3t@redis:6379');
    const payload = jsonLines()[0];
    expect(payload.message).not.toContain('s3cr3t');
    expect(payload.message).toContain('redis://***@redis:6379');
  });
});

// ─── Trace identifiers survive ────────────────────────────────────────────────

describe('traceability is preserved', () => {
  it('keeps correlationId / operationId / apiKeyId / errorCode intact', () => {
    new Logger({ correlationId: 'corr-abc', operationId: 'op-abc', apiKeyId: 'key-abc' })
      .info('m', { errorCode: 'E_TIMEOUT', jobId: '42' });

    expect(jsonLines()[0]).toMatchObject({
      correlationId: 'corr-abc',
      operationId: 'op-abc',
      apiKeyId: 'key-abc',
      errorCode: 'E_TIMEOUT',
      jobId: '42',
    });
  });

  it('still emits parseable JSON with the original KEYS', () => {
    new Logger({ service: 'svc' }).info('m', { content: 'x'.repeat(1500), outputChars: 1500 });
    const payload = jsonLines()[0];
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(['timestamp', 'level', 'message', 'service', 'content', 'outputChars']),
    );
    expect(payload.outputChars).toBe(1500);
  });

  it('respects LOG_LEVEL filtering as before', () => {
    process.env.LOG_LEVEL = 'WARN';
    const logger = new Logger({});
    logger.debug('nope');
    logger.info('nope');
    logger.warn('yes');
    expect(jsonLines().map((p) => p.message)).toEqual(['yes']);
  });
});

// ─── The trap: a hostile payload must not break logging ───────────────────────

describe('a hostile payload never breaks the log call', () => {
  it('logs an error whose meta contains a throwing getter, circular ref and BigInt', () => {
    const { job, lines } = makeJob();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const meta = {
      circular,
      big: BigInt(1),
      get boom(): string { throw new Error('getter exploded'); },
    };
    const original = new Error('the REAL failure');

    expect(() => new Logger({}, job).error('step failed', meta, original)).not.toThrow();

    // The original error must still be visible — a sanitizer failure must never
    // mask what actually went wrong.
    const serialized = JSON.stringify(jsonLines()[0]);
    expect(serialized).toContain('the REAL failure');
    expect(lines[0]).toContain('the REAL failure');
  });

  it('logs even when console output is the only sink and text format is active', () => {
    delete process.env.LOG_FORMAT;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => new Logger({ correlationId: 'c' }).warn('odd', { circular })).not.toThrow();
    expect(stderr).toHaveBeenCalled();
  });
});
