// lib/endpoints/file-urls-input.ts
// Shared `file_urls` form-field validator for both the Core API dispatcher
// (lib/endpoints/runner.ts) and the workflow entrypoint
// (app/api/v1/docs/workflows/route.ts).
//
// It UNIFIES the two previously-divergent parse blocks (02-CURRENT-STATE §1.6):
//   • strips a surrounding quote pair (Postman/form-data quirk) — was workflows-only
//   • validates `file_id` is a string when present                — was runner-only
//   • validates `total_chunks` is a positive integer when present — was workflows-only
//
// Contract: only INVALID input is rejected; every previously-valid payload is
// accepted unchanged, with byte-for-byte identical error `detail` strings so the
// two routes keep their existing 400 responses. The function never throws.

import { type FileUrlEntry, MAX_FILE_URL_ENTRIES } from '@/lib/file-url-downloader';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileUrlsInputOk {
  ok: true;
  /** Parsed entries, or `undefined` when no `file_urls` field was supplied. */
  entries: FileUrlEntry[] | undefined;
}

export interface FileUrlsInputError {
  ok: false;
  detail: string;
}

export type FileUrlsInputResult = FileUrlsInputOk | FileUrlsInputError;

export interface ParseFileUrlsOptions {
  /**
   * Default per-file Range-download chunk count applied ONLY to entries that do
   * not declare their own `total_chunks`. Sourced from
   * `ProfileEndpoint.fileUrlDefaultChunks`. `null`/`undefined` = no default.
   */
  defaultChunks?: number | null;
}

// ─── Main validator ─────────────────────────────────────────────────────────

/**
 * Parse and validate the raw `file_urls` form value.
 *
 * @param raw    The raw form field value (`form.get('file_urls')`).
 * @param options `defaultChunks` to backfill entries lacking `total_chunks`.
 */
export function parseFileUrlsInput(
  raw: string | null | undefined,
  options: ParseFileUrlsOptions = {},
): FileUrlsInputResult {
  // No field supplied → nothing to parse (both routes treat this as "no URLs").
  if (raw == null) return { ok: true, entries: undefined };
  let jsonStr = raw.trim();
  if (!jsonStr) return { ok: true, entries: undefined };

  // Strip a surrounding quote pair (Postman/form-data wraps JSON strings).
  if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
    jsonStr = jsonStr.slice(1, -1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, detail: 'file_urls must be a valid JSON array.' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, detail: 'file_urls must be a JSON array.' };
  }
  if (parsed.length > MAX_FILE_URL_ENTRIES) {
    return {
      ok: false,
      detail: `file_urls has ${parsed.length} entries. Maximum is ${MAX_FILE_URL_ENTRIES}.`,
    };
  }

  const entries: FileUrlEntry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry.url !== 'string' || !entry.url.trim()) {
      return {
        ok: false,
        detail: `file_urls[${i}]: each entry must have a non-empty "url" string field.`,
      };
    }
    try {
      new URL(entry.url);
    } catch {
      return {
        ok: false,
        detail: `file_urls[${i}]: "${entry.url}" is not a valid URL format.`,
      };
    }
    if (entry.file_id !== undefined && typeof entry.file_id !== 'string') {
      return {
        ok: false,
        detail: `file_urls[${i}]: "file_id" must be a string when provided.`,
      };
    }
    if (entry.total_chunks !== undefined) {
      if (
        typeof entry.total_chunks !== 'number' ||
        !Number.isInteger(entry.total_chunks) ||
        entry.total_chunks < 1
      ) {
        return {
          ok: false,
          detail: `file_urls[${i}]: "total_chunks" must be a positive integer (>= 1).`,
        };
      }
    }
    entries.push(entry as FileUrlEntry);
  }

  // Apply the endpoint default chunk count ONLY to entries that did not declare
  // their own total_chunks. A caller-supplied value always wins.
  applyDefaultChunks(entries, options.defaultChunks);

  return { ok: true, entries };
}

/**
 * Backfill `total_chunks` on entries that did not declare their own, using the
 * endpoint-level default (`ProfileEndpoint.fileUrlDefaultChunks`). A caller-
 * supplied value always wins. No-op when the default is absent or invalid, or
 * when there are no entries. Mutates entries in place.
 *
 * Shared by both the Core API dispatcher (runner.ts step 5b) and the workflow
 * entrypoint so the endpoint default behaves identically on both paths.
 */
export function applyDefaultChunks(
  entries: FileUrlEntry[] | undefined,
  defaultChunks: number | null | undefined,
): void {
  if (!entries || entries.length === 0) return;
  if (typeof defaultChunks !== 'number' || !Number.isInteger(defaultChunks) || defaultChunks < 1) return;
  for (const entry of entries) {
    if (entry.total_chunks === undefined) entry.total_chunks = defaultChunks;
  }
}
