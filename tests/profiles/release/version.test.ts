import { isSemanticVersion, suggestNextPatchVersion } from '@/lib/profiles/release/version';

describe('Profile Release semantic versions', () => {
  it('validates canonical semantic versions', () => {
    expect(isSemanticVersion('1.0.0')).toBe(true);
    expect(isSemanticVersion('2.4.1-rc.2+build.9')).toBe(true);
    expect(isSemanticVersion('1.2')).toBe(false);
    expect(isSemanticVersion('v1.2.3')).toBe(false);
  });

  it('suggests the next patch from the newest valid release version', () => {
    expect(suggestNextPatchVersion(['1.0.2', '1.0.1'])).toBe('1.0.3');
    expect(suggestNextPatchVersion([null, undefined])).toBe('1.0.0');
  });
});
