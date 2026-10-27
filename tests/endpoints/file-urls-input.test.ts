/**
 * `parseFileUrlsInput` unifies the two previously-divergent `file_urls` parse
 * blocks (Core API `runner.ts` and `workflows/route.ts`). These tests pin:
 *
 *   1. Every error `detail` string is byte-for-byte identical to what the two
 *      routes returned before, so their 400 responses do not change.
 *   2. The unified rules: quote-stripping (was workflows-only), `file_id`
 *      validation (was runner-only), `total_chunks` validation (was
 *      workflows-only) all apply on both routes now.
 *   3. `defaultChunks` backfills only entries that omit `total_chunks`.
 */
import { parseFileUrlsInput } from '@/lib/endpoints/file-urls-input';
import { MAX_FILE_URL_ENTRIES } from '@/lib/file-url-downloader';

describe('parseFileUrlsInput — empty / absent input', () => {
  it('returns ok with undefined entries when the field is null', () => {
    expect(parseFileUrlsInput(null)).toEqual({ ok: true, entries: undefined });
  });

  it('returns ok with undefined entries when the field is undefined', () => {
    expect(parseFileUrlsInput(undefined)).toEqual({ ok: true, entries: undefined });
  });

  it('returns ok with undefined entries when the field is blank whitespace', () => {
    expect(parseFileUrlsInput('   ')).toEqual({ ok: true, entries: undefined });
  });
});

describe('parseFileUrlsInput — happy path', () => {
  it('parses a valid single-entry array', () => {
    const res = parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf' }]));
    expect(res).toEqual({ ok: true, entries: [{ url: 'https://x.test/a.pdf' }] });
  });

  it('preserves file_id, filename, mime_type, total_chunks pass-through fields', () => {
    const raw = JSON.stringify([
      { url: 'https://x.test/a.pdf', file_id: 'doc-1', filename: 'a.pdf', mime_type: 'application/pdf', total_chunks: 3 },
    ]);
    const res = parseFileUrlsInput(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entries).toEqual([
        { url: 'https://x.test/a.pdf', file_id: 'doc-1', filename: 'a.pdf', mime_type: 'application/pdf', total_chunks: 3 },
      ]);
    }
  });

  it('accepts exactly MAX_FILE_URL_ENTRIES entries', () => {
    const arr = Array.from({ length: MAX_FILE_URL_ENTRIES }, (_, i) => ({ url: `https://x.test/${i}.pdf` }));
    const res = parseFileUrlsInput(JSON.stringify(arr));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries).toHaveLength(MAX_FILE_URL_ENTRIES);
  });
});

describe('parseFileUrlsInput — quote stripping (workflows parity)', () => {
  it('strips a surrounding quote pair before parsing', () => {
    const inner = JSON.stringify([{ url: 'https://x.test/a.pdf' }]);
    const wrapped = `"${inner}"`;
    const res = parseFileUrlsInput(wrapped);
    expect(res).toEqual({ ok: true, entries: [{ url: 'https://x.test/a.pdf' }] });
  });
});

describe('parseFileUrlsInput — rejection detail strings (byte-for-byte)', () => {
  it('rejects non-JSON', () => {
    expect(parseFileUrlsInput('not json')).toEqual({
      ok: false,
      detail: 'file_urls must be a valid JSON array.',
    });
  });

  it('rejects JSON that is not an array', () => {
    expect(parseFileUrlsInput(JSON.stringify({ url: 'https://x.test/a.pdf' }))).toEqual({
      ok: false,
      detail: 'file_urls must be a JSON array.',
    });
  });

  it('rejects more than MAX_FILE_URL_ENTRIES with actual and max counts', () => {
    const n = MAX_FILE_URL_ENTRIES + 1;
    const arr = Array.from({ length: n }, (_, i) => ({ url: `https://x.test/${i}.pdf` }));
    expect(parseFileUrlsInput(JSON.stringify(arr))).toEqual({
      ok: false,
      detail: `file_urls has ${n} entries. Maximum is ${MAX_FILE_URL_ENTRIES}.`,
    });
  });

  it('rejects a missing / empty url', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: '   ' }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: each entry must have a non-empty "url" string field.',
    });
    expect(parseFileUrlsInput(JSON.stringify([{ filename: 'a.pdf' }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: each entry must have a non-empty "url" string field.',
    });
  });

  it('rejects a non-null non-object entry', () => {
    expect(parseFileUrlsInput(JSON.stringify(['https://x.test/a.pdf']))).toEqual({
      ok: false,
      detail: 'file_urls[0]: each entry must have a non-empty "url" string field.',
    });
  });

  it('rejects a malformed url with the offending value in the detail', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: 'not-a-url' }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: "not-a-url" is not a valid URL format.',
    });
  });

  it('reports the index of the failing entry', () => {
    const raw = JSON.stringify([{ url: 'https://x.test/a.pdf' }, { url: 'bad' }]);
    expect(parseFileUrlsInput(raw)).toEqual({
      ok: false,
      detail: 'file_urls[1]: "bad" is not a valid URL format.',
    });
  });
});

describe('parseFileUrlsInput — file_id validation (runner parity)', () => {
  it('rejects a non-string file_id', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', file_id: 123 }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: "file_id" must be a string when provided.',
    });
  });

  it('accepts a string file_id', () => {
    const res = parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', file_id: 'x' }]));
    expect(res.ok).toBe(true);
  });
});

describe('parseFileUrlsInput — total_chunks validation (workflows parity)', () => {
  it('rejects a non-integer total_chunks', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', total_chunks: 1.5 }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: "total_chunks" must be a positive integer (>= 1).',
    });
  });

  it('rejects total_chunks < 1', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', total_chunks: 0 }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: "total_chunks" must be a positive integer (>= 1).',
    });
  });

  it('rejects a non-number total_chunks', () => {
    expect(parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', total_chunks: '3' }]))).toEqual({
      ok: false,
      detail: 'file_urls[0]: "total_chunks" must be a positive integer (>= 1).',
    });
  });

  it('accepts a positive integer total_chunks', () => {
    const res = parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf', total_chunks: 4 }]));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries?.[0].total_chunks).toBe(4);
  });
});

describe('parseFileUrlsInput — defaultChunks backfill', () => {
  it('applies defaultChunks only to entries that omit total_chunks', () => {
    const raw = JSON.stringify([
      { url: 'https://x.test/a.pdf' },
      { url: 'https://x.test/b.pdf', total_chunks: 2 },
    ]);
    const res = parseFileUrlsInput(raw, { defaultChunks: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entries?.[0].total_chunks).toBe(5); // backfilled
      expect(res.entries?.[1].total_chunks).toBe(2); // caller value preserved
    }
  });

  it('does not backfill when defaultChunks is null/undefined', () => {
    const res = parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf' }]), { defaultChunks: null });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries?.[0].total_chunks).toBeUndefined();
  });

  it('ignores an invalid defaultChunks (non-integer)', () => {
    const res = parseFileUrlsInput(JSON.stringify([{ url: 'https://x.test/a.pdf' }]), { defaultChunks: 1.5 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries?.[0].total_chunks).toBeUndefined();
  });
});
