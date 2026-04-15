// lib/file-url-downloader.ts
// Download files from URLs as streams, validate, and save via StorageBackend.
// Computes MD5 during streaming for FileCache dedup.

import path from 'path';
import { Readable } from 'stream';
import { assertSafeUrl } from '@/lib/pipelines/processors/http-client';
import { validateFileMetadata, MAX_FILE_SIZE } from '@/lib/upload';
import { getStorageBackend } from '@/lib/storage';
import { dedup } from '@/lib/storage/dedup';

const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.FILE_URL_DOWNLOAD_TIMEOUT_MS ?? '120000', 10);
const MAX_REDIRECTS = 5;
const READ_STALL_TIMEOUT_MS = parseInt(process.env.FILE_URL_READ_STALL_TIMEOUT_MS ?? '60000', 10); // Abort if no data received for N ms (slowloris protection). Default 60s for large files.
const MAX_FILENAME_LENGTH = 200; // Filesystem-safe limit

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileUrlEntry {
  url: string;
  filename?: string;
  mime_type?: string;
}

export interface FileUrlAuthConfig {
  type: 'none' | 'bearer' | 'header' | 'query';
  token?: string;
  header_name?: string;
  header_value?: string;
  query_key?: string;
  query_value?: string;
}

export const DEFAULT_FILE_URL_METADATA_FIELDS = [
  { key: 'filename', label: 'Tên file (override)', required: false },
  { key: 'mime_type', label: 'MIME type (override)', required: false },
  { key: 'description', label: 'Mô tả', required: false },
];

export const MAX_FILE_URL_ENTRIES = 20;

// ─── Downloaded file result (extended with cache fields) ─────────────────────

export interface DownloadedFile {
  name: string;
  path: string;
  mime: string;
  size: number;
  fileCacheId?: string;
  s3Key?: string;
  md5?: string;
}

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
  return base.substring(0, maxLen - ext.length) + ext;
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
      redirect: 'manual',
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`file_urls[${index}]: redirect (${response.status}) but no Location header`);
    }
    const redirectUrl = new URL(location, currentUrl).toString();
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
): Promise<DownloadedFile> {
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

  // 4. Content-Length pre-check
  const contentLength = parseInt(response.headers.get('content-length') ?? '', 10);
  if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE) {
    response.body?.cancel().catch(() => {});
    throw new Error(`file_urls[${index}]: Content-Length ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  // 5. Derive filename and MIME
  const contentDisposition = response.headers.get('content-disposition');
  const serverContentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();

  const rawFilename = (
    entry.filename?.trim() ||
    deriveFilenameFromContentDisposition(contentDisposition) ||
    deriveFilenameFromUrl(entry.url)
  ).normalize('NFC');

  const filename = truncateFilename(rawFilename, MAX_FILENAME_LENGTH);
  const mime = serverContentType || entry.mime_type?.trim() || 'application/octet-stream';

  // 5b. Early validation — check extension/MIME before downloading
  const earlyValidation = validateFileMetadata(filename, mime, 0, allowedExtsStr);
  if (!earlyValidation.valid && !earlyValidation.error.includes('quá lớn')) {
    response.body?.cancel().catch(() => {});
    throw new Error(`file_urls[${index}]: ${earlyValidation.error}`);
  }

  // 6. Stream to storage backend with size limit + stall detection
  if (!response.body) {
    throw new Error(`file_urls[${index}]: response body is empty`);
  }

  const safeName = `url_${index}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storageKey = `${operationId}/${safeName}`;

  const nodeReadable = Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>);

  // Wrap stream with size limit + stall detection, then pipe to storage backend
  let bytesWritten = 0;
  const backend = await getStorageBackend();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let uploadResult: import('@/lib/storage').UploadResult;

  const sizedStream = Readable.from((async function* () {
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), READ_STALL_TIMEOUT_MS);
    };
    resetStallTimer();
    try {
      for await (const chunk of nodeReadable) {
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
  })());

  try {
    uploadResult = await backend.upload(storageKey, sizedStream, { contentType: mime });
  } catch (err) {
    // Clean up partial upload on error
    await backend.delete(storageKey).catch(() => {});
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`file_urls[${index}]: download stalled — no data received for ${READ_STALL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

  // 7. Final size validation
  const validation = validateFileMetadata(filename, mime, uploadResult.bytesWritten, allowedExtsStr);
  if (!validation.valid) {
    await backend.delete(storageKey).catch(() => {});
    throw new Error(`file_urls[${index}]: ${validation.error}`);
  }

  // 8. MD5 dedup via FileCache — returns canonical s3Key (may differ if file was a duplicate)
  const dedupResult = await dedup(uploadResult.md5, uploadResult.s3Key, filename, mime, uploadResult.bytesWritten, backend);

  return {
    name: filename,
    path: dedupResult.s3Key,
    mime,
    size: uploadResult.bytesWritten,
    fileCacheId: dedupResult.id,
    s3Key: dedupResult.s3Key,
    md5: uploadResult.md5,
  };
}

// dedup() is in lib/storage/dedup.ts (shared with upload-helper.ts)

// ─── Batch download with cleanup ──────────────────────────────────────────────

const MAX_CONCURRENT_DOWNLOADS = 5;

export async function downloadAllFileUrls(
  entries: FileUrlEntry[],
  operationId: string,
  authConfig?: FileUrlAuthConfig,
  allowedExtsStr?: string,
): Promise<DownloadedFile[]> {
  const results: DownloadedFile[] = [];
  const backend = await getStorageBackend();

  try {
    for (let i = 0; i < entries.length; i += MAX_CONCURRENT_DOWNLOADS) {
      const batch = entries.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
      const settled = await Promise.allSettled(
        batch.map((entry, batchIndex) =>
          downloadFileUrl(entry, operationId, i + batchIndex, authConfig, allowedExtsStr),
        ),
      );

      const batchSuccesses: DownloadedFile[] = [];
      let firstError: unknown = null;
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          batchSuccesses.push(result.value);
        } else if (!firstError) {
          firstError = result.reason;
        }
      }

      if (firstError) {
        for (const file of batchSuccesses) {
          await backend.delete(file.s3Key ?? file.path).catch(() => {});
        }
        throw firstError;
      }

      results.push(...batchSuccesses);
    }
  } catch (err) {
    for (const file of results) {
      await backend.delete(file.s3Key ?? file.path).catch(() => {});
    }
    throw err;
  }

  return results;
}
