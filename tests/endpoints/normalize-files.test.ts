/**
 * `normalizeFiles` is shared by all 7 API services, so a change here reaches every
 * live integration. The `files` (no brackets) alias was added for the
 * financial-report SRS contract; these tests pin the two properties that keep it
 * safe for everyone else:
 *
 *   1. an existing `files[]` caller behaves exactly as before,
 *   2. a caller that sends BOTH names does not get its document attached twice
 *      (which would double AI tokens, double cost and duplicate the output).
 */
import { normalizeFiles } from '@/lib/endpoints/runner';

const file = (name: string, body = 'x') => new File([body], name, { type: 'application/pdf' });

describe('normalizeFiles', () => {
  it('accepts the historical files[] field', () => {
    const form = new FormData();
    form.append('files[]', file('a.pdf'));
    form.append('files[]', file('b.pdf'));

    expect(normalizeFiles(form).map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('accepts the files alias when files[] is absent (financial-report contract)', () => {
    const form = new FormData();
    form.append('files', file('bctc.pdf'));

    expect(normalizeFiles(form).map((f) => f.name)).toEqual(['bctc.pdf']);
  });

  it('does not attach the same document twice when a caller sends both names', () => {
    const form = new FormData();
    form.append('files[]', file('a.pdf'));
    form.append('files', file('a.pdf'));

    // files[] wins; the alias is ignored. Reading both would have produced two
    // attachments for one document.
    expect(normalizeFiles(form).map((f) => f.name)).toEqual(['a.pdf']);
  });

  it('ignores a text field that happens to be named files', () => {
    const form = new FormData();
    form.append('files', 'not-a-file');
    form.append('file', file('single.pdf'));

    expect(normalizeFiles(form).map((f) => f.name)).toEqual(['single.pdf']);
  });

  it('ignores empty files', () => {
    const form = new FormData();
    form.append('files[]', new File([], 'empty.pdf'));

    expect(normalizeFiles(form)).toEqual([]);
  });

  it('still collects file, source_file and target_file', () => {
    const form = new FormData();
    form.append('source_file', file('src.pdf'));
    form.append('target_file', file('tgt.pdf'));
    form.append('file', file('single.pdf'));

    expect(normalizeFiles(form).map((f) => f.name)).toEqual(['src.pdf', 'tgt.pdf', 'single.pdf']);
  });
});
