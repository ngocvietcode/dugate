/**
 * Validation of the User.email field (lib/users/email.ts).
 *
 * Email is one of the two keys an incoming SSO identity is matched against
 * (lib/auth.ts), and it is the one an administrator can still correct when the IDP
 * presents a username in an unexpected shape. Garbage stored here means a person
 * silently cannot sign in, so parsing is pinned by tests.
 */
import { parseUserEmail, EMAIL_MAX_LENGTH } from '@/lib/users/email';

describe('parseUserEmail', () => {
  it('treats an omitted value as "no email"', () => {
    expect(parseUserEmail(undefined)).toEqual({ ok: true, email: null });
  });

  it('treats blank input as clearing the address', () => {
    // This is how an administrator removes a wrong address through the UI.
    expect(parseUserEmail('')).toEqual({ ok: true, email: null });
    expect(parseUserEmail('   ')).toEqual({ ok: true, email: null });
  });

  it('trims and lower-cases so a match cannot be missed on capitalisation', () => {
    expect(parseUserEmail('  HieuPB@VPBank.com.vn  ')).toEqual({
      ok: true,
      email: 'hieupb@vpbank.com.vn',
    });
  });

  it.each([
    ['no at sign', 'hieupb'],
    ['two at signs', 'a@b@vpbank.com.vn'],
    ['no domain dot', 'hieupb@vpbank'],
    ['trailing dot', 'hieupb@vpbank.'],
    ['leading at', '@vpbank.com.vn'],
    ['inner whitespace', 'hieu pb@vpbank.com.vn'],
  ])('rejects %s', (_label, input) => {
    expect(parseUserEmail(input)).toEqual({ ok: false, error: 'Email không hợp lệ' });
  });

  it('rejects a non-string value', () => {
    expect(parseUserEmail(42)).toEqual({ ok: false, error: 'Email không hợp lệ' });
    expect(parseUserEmail(null)).toEqual({ ok: false, error: 'Email không hợp lệ' });
  });

  it('rejects an address longer than the RFC path limit', () => {
    const tooLong = `${'a'.repeat(EMAIL_MAX_LENGTH)}@vpbank.com.vn`;
    const result = parseUserEmail(tooLong);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(EMAIL_MAX_LENGTH));
  });

  it('accepts an address at exactly the limit', () => {
    const domain = '@vpbank.com.vn';
    const atLimit = `${'a'.repeat(EMAIL_MAX_LENGTH - domain.length)}${domain}`;

    expect(atLimit).toHaveLength(EMAIL_MAX_LENGTH);
    expect(parseUserEmail(atLimit)).toEqual({ ok: true, email: atLimit });
  });

  it('accepts the shapes real company addresses take', () => {
    for (const address of [
      'hieupb@vpbank.com.vn',
      'hieu.pb@vpbank.com.vn',
      'hieu-pb@vpbank.com.vn',
      'hieu_pb@sub.vpbank.com.vn',
      'hieupb+ops@vpbank.com.vn',
    ]) {
      expect(parseUserEmail(address)).toEqual({ ok: true, email: address });
    }
  });
});
