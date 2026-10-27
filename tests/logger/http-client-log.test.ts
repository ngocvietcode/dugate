// tests/logger/http-client-log.test.ts
// T3.2 — SECRET_KEY_PATTERN / BEARER_PATTERN moved into lib/log-sanitize.ts and
//        shared with summarizeErrorBody(); behaviour must be unchanged.
// T5.6 — logCurlCommand only appears at LOG_LEVEL=DEBUG (done in Task 1; guarded here).

import { Logger } from '@/lib/logger';
import * as sanitize from '@/lib/log-sanitize';
import {
  BEARER_PATTERN,
  MAX_ERROR_BODY_CHARS,
  SECRET_KEY_PATTERN,
  logCurlCommand,
  summarizeErrorBody,
} from '@/lib/pipelines/processors/http-client';

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ['LOG_LEVEL', 'LOG_FORMAT']) saved[key] = process.env[key];
  process.env.LOG_FORMAT = 'json';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of ['LOG_LEVEL', 'LOG_FORMAT']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('T3.2 — one definition of the credential patterns', () => {
  it('http-client re-exports the very same regex objects as log-sanitize', () => {
    expect(SECRET_KEY_PATTERN).toBe(sanitize.SECRET_KEY_PATTERN);
    expect(BEARER_PATTERN).toBe(sanitize.BEARER_PATTERN);
  });

  it('summarizeErrorBody still redacts, collapses and truncates', () => {
    const body = `{\n  "error": "bad model",\n  "api_key": "sk-live-LEAK",\n  "auth": "Bearer eyJhbGciOiJIUzI1NiJ9"\n}`;
    const out = summarizeErrorBody(body);

    expect(out).not.toContain('sk-live-LEAK');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('bad model');
    expect(out).not.toMatch(/\n/);
  });

  it('summarizeErrorBody truncates at MAX_ERROR_BODY_CHARS', () => {
    const out = summarizeErrorBody('x'.repeat(2000));
    expect(out.startsWith('x'.repeat(MAX_ERROR_BODY_CHARS))).toBe(true);
    expect(out).toContain('(truncated)');
  });

  it('shared /g regexes are not left stateful between calls', () => {
    // A /g regex reused via .test() would skip every other match. Two identical
    // calls must produce identical output.
    const body = '{"token":"abc12345678"}';
    expect(summarizeErrorBody(body)).toBe(summarizeErrorBody(body));
  });
});

describe('T5.6 — logCurlCommand is DEBUG-only and never echoes the JSON body', () => {
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': 'sk-live-LEAK' };
  const jsonBody = JSON.stringify({
    prompt: 'extract the disbursement table',
    file: `data:application/pdf;base64,${'QUJD'.repeat(500)}`,
  });

  it('emits nothing at LOG_LEVEL=INFO', () => {
    process.env.LOG_LEVEL = 'INFO';
    logCurlCommand('https://aihub.example.com/v1/chat', 'POST', headers, jsonBody, new Logger({}));
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('at LOG_LEVEL=DEBUG logs metadata only — no body, no base64, no auth header', () => {
    process.env.LOG_LEVEL = 'DEBUG';
    logCurlCommand('https://aihub.example.com/v1/chat?key=abc', 'POST', headers, jsonBody, new Logger({}));

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = String((console.log as jest.Mock).mock.calls[0][0]);

    expect(line).toContain('<REDACTED_JSON_BODY chars=');
    expect(line).not.toContain('QUJDQUJD');
    expect(line).not.toContain('extract the disbursement table');
    expect(line).not.toContain('sk-live-LEAK');
    // Query string is stripped by sanitizeUrlForLogging — it can carry credentials.
    expect(line).not.toContain('key=abc');
    expect(line).toContain('aihub.example.com');
  });
});
