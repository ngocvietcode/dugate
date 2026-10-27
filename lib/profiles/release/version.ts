export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemanticVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

/** Suggest the next patch from the newest valid release version. */
export function suggestNextPatchVersion(versions: Array<string | null | undefined>): string {
  const latest = versions.find((version) => isSemanticVersion(version));
  if (!latest) return '1.0.0';

  const match = latest.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.0.0';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
