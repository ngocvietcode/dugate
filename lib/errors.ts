// lib/errors.ts
// RFC 9457 Problem Details for HTTP APIs helpers.
// https://www.rfc-editor.org/rfc/rfc9457

// Use NEXTAUTH_URL (already required by Next-Auth) as the base for error type URIs.
// Falls back to the legacy production URL if the env var is not set.
const _base = (process.env.NEXTAUTH_URL ?? 'https://dugate.vn').replace(/\/$/, '');
export const BASE_TYPE_URI = `${_base}/errors`;

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/**
 * Build an RFC 9457 problem detail object.
 *
 * @param status  HTTP status code
 * @param slug    Short machine-readable identifier (e.g. "not-found", "invalid-param")
 * @param title   Human-readable summary (should be stable across occurrences)
 * @param detail  Optional human-readable explanation for this specific occurrence
 */
export function createProblemDetail(
  status: number,
  slug: string,
  title: string,
  detail?: string,
): ProblemDetail {
  return {
    type: `${BASE_TYPE_URI}/${slug}`,
    title,
    status,
    ...(detail ? { detail } : {}),
  };
}
