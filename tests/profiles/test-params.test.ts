/**
 * The Profile "Test Endpoint" payload must not contain admin-locked parameters.
 *
 * Server contract (lib/endpoints/profile-resolver.ts → mergeParameters): the mere
 * PRESENCE of a locked key in the form is a 400 `forbidden-field`. The Test modal
 * pre-fills its inputs from saved profile values, locked ones included, so
 * appending every non-empty entry made Test impossible to pass on any endpoint
 * that had a locked parameter.
 */
import { isParamLocked, selectSendableTestParams } from '@/lib/profiles/test-params';

const schema = {
  language: { defaultLocked: false },
  output_format: { defaultLocked: true },
  fields: {},
};

describe('isParamLocked', () => {
  it('prefers the stored profile flag over the schema default', () => {
    expect(isParamLocked('output_format', { output_format: { value: 'json', isLocked: false } }, schema)).toBe(false);
    expect(isParamLocked('language', { language: { value: 'vi', isLocked: true } }, schema)).toBe(true);
  });

  it('falls back to the schema default, then to unlocked', () => {
    expect(isParamLocked('output_format', {}, schema)).toBe(true);
    expect(isParamLocked('language', {}, schema)).toBe(false);
    expect(isParamLocked('fields', {}, schema)).toBe(false);
    expect(isParamLocked('unknown', {}, schema)).toBe(false);
  });
});

describe('selectSendableTestParams', () => {
  it('drops a schema-locked parameter that the modal pre-filled', () => {
    const testParams = { language: 'vi', output_format: 'markdown' };

    const sendable = selectSendableTestParams(testParams, {}, schema);

    expect(sendable).toEqual([['language', 'vi']]);
    // Sending output_format here is what produced:
    // "The 'output_format' field cannot be set by the client."
    expect(sendable.map(([key]) => key)).not.toContain('output_format');
  });

  it('drops a parameter locked only by the stored profile config', () => {
    const paramsObj = { language: { value: 'vi', isLocked: true } };

    const sendable = selectSendableTestParams({ language: 'en', fields: 'a,b' }, paramsObj, schema);

    expect(sendable).toEqual([['fields', 'a,b']]);
  });

  it('sends an unlocked parameter even when the profile stored a value for it', () => {
    const paramsObj = { language: { value: 'vi', isLocked: false } };

    expect(selectSendableTestParams({ language: 'ja' }, paramsObj, schema)).toEqual([['language', 'ja']]);
  });

  it('skips empty, undefined and null values', () => {
    const sendable = selectSendableTestParams(
      { language: '', fields: undefined, focus: null, style: 'formal' },
      {},
      schema,
    );

    expect(sendable).toEqual([['style', 'formal']]);
  });

  it('stringifies values so FormData never receives a non-string', () => {
    const sendable = selectSendableTestParams({ pages: 3 as unknown as string }, {}, schema);

    expect(sendable).toEqual([['pages', '3']]);
  });
});
