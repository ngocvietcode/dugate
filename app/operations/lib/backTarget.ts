// app/operations/lib/backTarget.ts
// Resolves where the "Quay lại danh sách" button on the operation detail page
// should navigate, so the Operations list filters (profile, state, endpoint,
// time range, page) survive the round-trip.
//
// Priority:
//   1. `from` query param — the exact list URL captured when the row was clicked.
//      Only accepted when it is an internal `/operations` path (open-redirect guard).
//   2. Operation's own profile → `/operations?tab=requests&profile=<apiKeyId>`.
//      Covers direct URL paste (no history/`from`) and matches the BA request:
//      back should land on the request list of the profile being viewed.
//   3. Plain `/operations` fallback.

const OPERATIONS_LIST_PATH = '/operations';

/**
 * True only for the same-origin Operations *list* path (e.g. `/operations` or
 * `/operations?tab=requests&profile=x`). Rejects absolute/protocol-relative URLs
 * and detail paths like `/operations/<id>` so back never bounces to another detail.
 */
function isSafeOperationsPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  const path = value.split(/[?#]/)[0];
  return path === OPERATIONS_LIST_PATH;
}

export function resolveOperationsBackUrl(
  fromParam: string | null | undefined,
  apiKeyId?: string | null,
): string {
  // 1. Explicit return URL captured from the list.
  if (fromParam) {
    let decoded = fromParam;
    try {
      decoded = decodeURIComponent(fromParam);
    } catch {
      decoded = fromParam;
    }
    if (isSafeOperationsPath(decoded)) return decoded;
  }

  // 2. Fall back to the profile's filtered request list.
  if (apiKeyId) {
    return `${OPERATIONS_LIST_PATH}?tab=requests&profile=${encodeURIComponent(apiKeyId)}`;
  }

  // 3. Bare list.
  return OPERATIONS_LIST_PATH;
}
