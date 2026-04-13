// lib/errors.ts
// RFC 9457 Problem Details for HTTP APIs helpers.
// https://www.rfc-editor.org/rfc/rfc9457

const BASE_TYPE_URI = 'https://dugate.vn/errors';

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
