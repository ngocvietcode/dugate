// lib/file-url-downloader.ts
// Download files from URLs as streams, validate, and save to disk.
// Reuses SSRF protection and file validation from existing utilities.

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { assertSafeUrl } from '@/lib/pipelines/processors/http-client';
import { validateFileMetadata, MAX_FILE_SIZE } from '@/lib/upload';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.FILE_URL_DOWNLOAD_TIMEOUT_MS ?? '120000', 10);
const MAX_REDIRECTS = 5;
const READ_STALL_TIMEOUT_MS = 15_000; // Abort if no data received for 15s (slowloris protection)
const MAX_FILENAME_LENGTH = 200; // Filesystem-safe limit

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileUrlEntry {
  url: string;
  filename?: string;     // override filename (default: derived from URL path / Content-Disposition)
  mime_type?: string;    // hint only — actual Content-Type from server takes priority
}

export interface FileUrlAuthConfig {
  type: 'none' | 'bearer' | 'header' | 'query';
  token?: string;          // for bearer
  header_name?: string;    // for custom header
  header_value?: string;   // for custom header
  query_key?: string;      // for query param
  query_value?: string;    // for query param
}

/** Default metadata fields shown in the UI for each file_urls entry */
export const DEFAULT_FILE_URL_METADATA_FIELDS = [
  { key: 'filename', label: 'Tên file (override)', required: false },
  { key: 'mime_type', label: 'MIME type (override)', required: false },
  { key: 'description', label: 'Mô tả', required: false },
];

/** Maximum number of file_urls entries per request */
export const MAX_FILE_URL_ENTRIES = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return base && base !== '/' ? decodeURIComponent(base) : 'downloaded_file';
  } catch {
    return 'downloaded_file';
  }
}

function deriveFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

function truncateFilename(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const truncated = base.substring(0, maxLen - ext.length);
  return truncated + ext;
}

function buildDownloadHeaders(authConfig?: FileUrlAuthConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!authConfig || authConfig.type === 'none') return headers;

  if (authConfig.type === 'bearer' && authConfig.token) {
    headers['Authorization'] = `Bearer ${authConfig.token}`;
  } else if (authConfig.type === 'header' && authConfig.header_name && authConfig.header_value) {
    headers[authConfig.header_name] = authConfig.header_value;
  }
  return headers;
}

function applyQueryAuth(urlStr: string, authConfig?: FileUrlAuthConfig): string {
  if (!authConfig || authConfig.type !== 'query') return urlStr;
  if (!authConfig.query_key || !authConfig.query_value) return urlStr;
  try {
    const url = new URL(urlStr);
    url.searchParams.set(authConfig.query_key, authConfig.query_value);
    return url.toString();
  } catch {
    return urlStr;
  }
}

/**
 * Fetch a URL with manual redirect handling (SSRF-safe).
 * Each redirect target is validated via assertSafeUrl before following.
 */
async function safeFetch(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  index: number,
): Promise<Response> {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      headers,
      signal,
      redirect: 'manual', // Don't auto-follow — validate each redirect target
    });

    // Not a redirect — return the response
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    // Handle redirect
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`file_urls[${index}]: redirect (${response.status}) but no Location header`);
    }

    // Resolve relative redirect URLs against current URL
    const redirectUrl = new URL(location, currentUrl).toString();

    // Validate redirect target against SSRF — strip query auth (never forward creds to redirect)
    currentUrl = await assertSafeUrl(redirectUrl);
  }

  throw new Error(`file_urls[${index}]: too many redirects (>${MAX_REDIRECTS})`);
}

// ─── Core download function ───────────────────────────────────────────────────

export async function downloadFileUrl(
  entry: FileUrlEntry,
  operationId: string,
  index: number,
  authConfig?: FileUrlAuthConfig,
  allowedExtsStr?: string,
): Promise<{ name: string; path: string; mime: string; size: number }> {
  // 1. SSRF protection
  const safeUrl = await assertSafeUrl(applyQueryAuth(entry.url, authConfig));

  // 2. Build request headers
  const headers = buildDownloadHeaders(authConfig);

  // 3. Fetch with timeout + manual redirect following
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await safeFetch(safeUrl, headers, controller.signal, index);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`file_urls[${index}]: download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`);
    }
    throw err instanceof Error ? err : new Error(`file_urls[${index}]: network error — ${String(err)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    // Read only a small portion of the error body to avoid memory issues
    const reader = response.body?.getReader();
    let errorSnippet = '';
    if (reader) {
      try {
        const { value } = await reader.read();
        errorSnippet = value ? new TextDecoder().decode(value).substring(0, 200) : '';
        reader.cancel().catch(() => {});
      } catch { /* ignore */ }
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`file_urls[${index}]: authentication failed (HTTP ${response.status})`);
    }
    throw new Error(`file_urls[${index}]: remote server returned HTTP ${response.status}: ${errorSnippet}`);
  }

  // 4. Content-Length pre-check — reject before streaming if server declares size > limit
  const contentLength = parseInt(response.headers.get('content-length') ?? '', 10);
  if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE) {
    response.body?.cancel().catch(() => {});
    throw new Error(`file_urls[${index}]: Content-Length ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  // 5. Derive filename and MIME
  //    Server Content-Type takes priority over client hint (prevents MIME spoofing)
  const contentDisposition = response.headers.get('content-disposition');
  const serverContentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();

  const rawFilename = (
    entry.filename?.trim() ||
    deriveFilenameFromContentDisposition(contentDisposition) ||
    deriveFilenameFromUrl(entry.url)
  ).normalize('NFC');

  const filename = truncateFilename(rawFilename, MAX_FILENAME_LENGTH);

  // Server Content-Type > client hint > fallback
  const mime = serverContentType || entry.mime_type?.trim() || 'application/octet-stream';

  // 5b. Early validation — check extension/MIME before downloading
  const earlyValidation = validateFileMetadata(filename, mime, 0, allowedExtsStr);
  if (!earlyValidation.valid && !earlyValidation.error.includes('quá lớn')) {
    // Extension/MIME invalid — no need to download
    response.body?.cancel().catch(() => {});
    throw new Error(`file_urls[${index}]: ${earlyValidation.error}`);
  }

  // 6. Stream to disk with size limit + read-stall timeout (slowloris protection)
  const dir = path.join(UPLOAD_DIR, operationId);
  await fsPromises.mkdir(dir, { recursive: true });

  const safeName = `url_${index}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(dir, safeName);

  const writeStream = fs.createWriteStream(filePath);
  let bytesWritten = 0;

  if (!response.body) {
    throw new Error(`file_urls[${index}]: response body is empty`);
  }

  const nodeReadable = Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>);

  try {
    await pipeline(
      nodeReadable,
      async function* (source) {
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const resetStallTimer = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            controller.abort();
          }, READ_STALL_TIMEOUT_MS);
        };
        resetStallTimer();
        try {
          for await (const chunk of source) {
            bytesWritten += chunk.length;
            if (bytesWritten > MAX_FILE_SIZE) {
              throw new Error(`file_urls[${index}]: file exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
            }
            resetStallTimer();
            yield chunk;
          }
        } finally {
          if (stallTimer) clearTimeout(stallTimer);
        }
      },
      writeStream,
    );
  } catch (err) {
    // Clean up partial file on error
    await fsPromises.unlink(filePath).catch(() => {});
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`file_urls[${index}]: download stalled — no data received for ${READ_STALL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

  // 7. Final size validation (in case Content-Length was absent/wrong)
  const validation = validateFileMetadata(filename, mime, bytesWritten, allowedExtsStr);
  if (!validation.valid) {
    await fsPromises.unlink(filePath).catch(() => {});
    throw new Error(`file_urls[${index}]: ${validation.error}`);
  }

  // 8. Normalize path (Windows → Linux Docker compatibility)
  const normalizedPath = filePath.replace(/\\/g, '/');

  return { name: filename, path: normalizedPath, mime, size: bytesWritten };
}

// ─── Batch download with cleanup ──────────────────────────────────────────────

const MAX_CONCURRENT_DOWNLOADS = 5;

export async function downloadAllFileUrls(
  entries: FileUrlEntry[],
  operationId: string,
  authConfig?: FileUrlAuthConfig,
  allowedExtsStr?: string,
): Promise<Array<{ name: string; path: string; mime: string; size: number }>> {
  const results: Array<{ name: string; path: string; mime: string; size: number }> = [];

  try {
    // Process in batches to limit concurrency
    for (let i = 0; i < entries.length; i += MAX_CONCURRENT_DOWNLOADS) {
      const batch = entries.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
      const batchResults = await Promise.all(
        batch.map((entry, batchIndex) =>
          downloadFileUrl(entry, operationId, i + batchIndex, authConfig, allowedExtsStr),
        ),
      );
      results.push(...batchResults);
    }
  } catch (err) {
    // Clean up ALL successfully downloaded files on any failure
    for (const file of results) {
      await fsPromises.unlink(file.path).catch(() => {});
    }
    throw err;
  }

  return results;
}
