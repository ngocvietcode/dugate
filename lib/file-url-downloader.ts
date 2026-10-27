// lib/file-url-downloader.ts
// Download files from URLs as streams, validate, and save via StorageBackend.
// Computes MD5 during streaming for FileCache dedup.

import path from 'path';
import { Readable } from 'stream';
import { buildGatewayHeaders, buildSyncAuthHeaders, applyQueryAuth as applySyncQueryAuth } from '@/lib/auth-config/apply';
import { resolveAuthConfigSecrets } from '@/lib/auth-config/resolve-secret';
import type { AuthConfig, FileUrlAuthConfig } from '@/lib/auth-config/types';
import { assertSafeUrl, ssrfSafeFetch } from '@/lib/pipelines/processors/http-client';
import { validateFileMetadata, MAX_FILE_SIZE } from '@/lib/upload';
import { getStorageBackend } from '@/lib/storage';
import { dedup } from '@/lib/storage/dedup';
import { db } from '@/lib/db';
import { fileCaches } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export { parseFileUrlAuthConfig } from '@/lib/auth-config/parse';
export type { AuthConfig, FileUrlAuthConfig } from '@/lib/auth-config/types';

const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.FILE_URL_DOWNLOAD_TIMEOUT_MS ?? '120000', 10);
const MAX_REDIRECTS = 5;
// Chunk size for Range-based downloads of large files (matches Python csp_client chunk_size).
// Only used when an entry sets total_chunks > 1. Default 10 MiB.
const CSP_CHUNK_SIZE = parseInt(process.env.CSP_CHUNK_SIZE ?? '10485760', 10);
const READ_STALL_TIMEOUT_MS = parseInt(process.env.FILE_URL_READ_STALL_TIMEOUT_MS ?? '60000', 10); // Abort if no data received for N ms (slowloris protection). Default 60s for large files.
const MAX_FILENAME_LENGTH = 200; // Filesystem-safe limit

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileUrlEntry {
  url: string;
  filename?: string;
  mime_type?: string;
  file_id?: string;   // Echo-back identifier (IDP's document id), pass-through only
  total_chunks?: number;   // Per-file Range-download chunk count (for large CSP files). Default 1 = single GET.
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
  file_id?: string;   // Echo-back identifier carried from FileUrlEntry (not part of dedup key)
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
  // Remove Vietnamese diacritics → ASCII for CAIP compatibility
  let safe = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
  // Remove non-ASCII characters
  safe = safe.replace(/[^\w.\-() ]/g, '_').replace(/[_ ]+/g, '_').replace(/^_|_$/g, '');
  if (!safe) safe = 'file' + path.extname(name);
  if (safe.length <= maxLen) return safe;
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  return base.substring(0, maxLen - ext.length) + ext;
}

function buildDownloadHeaders(authConfig?: AuthConfig): Record<string, string> {
  return buildSyncAuthHeaders(authConfig);
}

function applyQueryAuth(urlStr: string, authConfig?: AuthConfig): string {
  return applySyncQueryAuth(urlStr, authConfig);
}

function isCredentialedAuth(authConfig?: FileUrlAuthConfig): boolean {
  return Boolean(authConfig && (
    authConfig.type !== 'none'
    || authConfig.ibm_client_id
    || authConfig.gateway_headers?.length
  ));
}

/** Parse ALLOWED_FILE_AUTH_ORIGINS into a list of exact origins (empty = unconfigured). */
function fileAuthAllowlist(): string[] {
  return (process.env.ALLOWED_FILE_AUTH_ORIGINS ?? '')
    .split(',')
    .map((configured) => configured.trim())
    .filter(Boolean);
}

/**
 * Whether credentials may be sent to this URL's origin.
 *
 * Opt-in semantics: when ALLOWED_FILE_AUTH_ORIGINS is unset, credentials are
 * permitted for any already-SSRF-validated origin (pre-hardening behaviour).
 * Configure the env var to restrict credentialed downloads to exact origins.
 */
function isAllowedFileAuthOrigin(rawUrl: string): boolean {
  const allowed = fileAuthAllowlist();
  if (allowed.length === 0) return true;
  let origin: string;
  try { origin = new URL(rawUrl).origin; } catch { return false; }
  return allowed.some((configured) => {
    try { return new URL(configured).origin === origin; } catch { return false; }
  });
}

async function safeFetch(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  index: number,
  credentialOrigin?: string,
): Promise<Response> {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (credentialOrigin && new URL(currentUrl).origin !== credentialOrigin) {
      throw new Error(`file_urls[${index}]: credentialed cross-origin redirect is not allowed`);
    }
    const response = await ssrfSafeFetch(currentUrl, { headers, signal });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
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
  // 1. SSRF protection + credential destination authorization.
  const unauthenticatedSafeUrl = await assertSafeUrl(entry.url);
  const credentialed = isCredentialedAuth(authConfig);
  const allowlistActive = fileAuthAllowlist().length > 0;
  if (credentialed && allowlistActive && !isAllowedFileAuthOrigin(unauthenticatedSafeUrl)) {
    throw new Error(`file_urls[${index}]: Profile file credentials are not authorized for this origin`);
  }
  // Same-origin credentialed-redirect enforcement applies only when an allowlist
  // is configured; unconfigured deployments keep legacy redirect behaviour.
  const credentialOrigin = (credentialed && allowlistActive)
    ? new URL(unauthenticatedSafeUrl).origin
    : undefined;
  const resolvedAuthConfig = authConfig
    ? await resolveAuthConfigSecrets(authConfig)
    : undefined;
  if (authConfig && !resolvedAuthConfig) {
    throw new Error(`file_urls[${index}]: Profile file credentials could not be resolved`);
  }
  const effectiveAuthConfig = resolvedAuthConfig ?? authConfig;
  const safeUrl = await assertSafeUrl(applyQueryAuth(unauthenticatedSafeUrl, effectiveAuthConfig));

  // 2. Resolve every configured secret once after credential-origin gating, then
  // apply the effective auth consistently to URL, headers, and token retrieval.
  const gatewayHeaders = buildGatewayHeaders(effectiveAuthConfig);
  const headers = { ...gatewayHeaders, ...buildDownloadHeaders(effectiveAuthConfig) };

  if (effectiveAuthConfig?.type === 'csp_oauth2'
      && effectiveAuthConfig.token_url && effectiveAuthConfig.client_id && effectiveAuthConfig.client_secret) {
    const { getCspToken } = await import('@/lib/csp-token');
    const safeTokenUrl = await assertSafeUrl(effectiveAuthConfig.token_url);
    const token = await getCspToken({
      token_url: safeTokenUrl,
      client_id: effectiveAuthConfig.client_id,
      client_secret: effectiveAuthConfig.client_secret,
      ibm_client_id: effectiveAuthConfig.ibm_client_id,
      gateway_headers: gatewayHeaders,
    });
    headers.Authorization = `Bearer ${token}`;
  }
  if (effectiveAuthConfig?.type === 'oauth2_client_credentials'
      && effectiveAuthConfig.token_url && effectiveAuthConfig.client_id && effectiveAuthConfig.client_secret) {
    const { getOAuth2Token } = await import('@/lib/auth-config/oauth2-token');
    const safeTokenUrl = await assertSafeUrl(effectiveAuthConfig.token_url);
    const token = await getOAuth2Token({
      token_url: safeTokenUrl,
      client_id: effectiveAuthConfig.client_id,
      client_secret: effectiveAuthConfig.client_secret,
      token_body_format: effectiveAuthConfig.token_body_format,
      token_auth_style: effectiveAuthConfig.token_auth_style,
      scope: effectiveAuthConfig.scope,
      audience: effectiveAuthConfig.audience,
      token_response_path: effectiveAuthConfig.token_response_path,
      ...(Object.keys(gatewayHeaders).length ? { token_extra_headers: gatewayHeaders } : {}),
    });
    headers.Authorization = `Bearer ${token}`;
  }

  // Per-file chunk count: 1 = single GET (default). >1 = Range-based chunked download for large files.
  const totalChunks = Math.max(1, Math.floor(entry.total_chunks ?? 1));
  // Range window size: profile-configured csp_chunk_size (if a positive integer), else CSP_CHUNK_SIZE env default.
  const chunkSize = effectiveAuthConfig?.csp_chunk_size && effectiveAuthConfig.csp_chunk_size > 0
    ? Math.floor(effectiveAuthConfig.csp_chunk_size)
    : CSP_CHUNK_SIZE;

  // 3. Fetch with timeout + manual redirect following.
  // For chunked mode, this fetches chunk 0 (Range: bytes=0-...) — its headers carry
  // filename/mime for the whole file, same as the single-GET response below.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    const firstHeaders = totalChunks > 1
      ? { ...headers, Range: `bytes=0-${chunkSize - 1}` }
      : headers;
    response = await safeFetch(safeUrl, firstHeaders, controller.signal, index, credentialOrigin);
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

  // 4. Content-Length pre-check (single-GET only). In chunked mode this header reflects
  // one chunk's size, not the whole file — the streaming MAX_FILE_SIZE counter (step 6)
  // enforces the real cap across all concatenated chunks instead.
  if (totalChunks <= 1) {
    const contentLength = parseInt(response.headers.get('content-length') ?? '', 10);
    if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE) {
      response.body?.cancel().catch(() => {});
      throw new Error(`file_urls[${index}]: Content-Length ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }
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

  // Build the byte source. Single-GET: stream the one response body.
  // Chunked: stream chunk 0 (already fetched), then fetch chunks 1..N-1 sequentially
  // with fresh Range GETs, concatenating their bodies into one continuous stream.
  const nodeReadable = totalChunks <= 1
    ? Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>)
    : Readable.from((async function* () {
        // Chunk 0 — already fetched above.
        yield* Readable.fromWeb(response.body as import('stream/web').ReadableStream<Uint8Array>);

        // Chunks 1..N-1 — sequential ranged GETs.
        for (let chunkIdx = 1; chunkIdx < totalChunks; chunkIdx++) {
          const byteStart = chunkIdx * chunkSize;
          const byteEnd = (chunkIdx + 1) * chunkSize - 1;
          const chunkHeaders = { ...headers, Range: `bytes=${byteStart}-${byteEnd}` };

          const chunkController = new AbortController();
          const chunkTimeout = setTimeout(() => chunkController.abort(), DOWNLOAD_TIMEOUT_MS);
          let chunkResponse: Response;
          try {
            chunkResponse = await safeFetch(safeUrl, chunkHeaders, chunkController.signal, index, credentialOrigin);
          } finally {
            clearTimeout(chunkTimeout);
          }

          if (!chunkResponse.ok) {
            chunkResponse.body?.cancel().catch(() => {});
            throw new Error(`file_urls[${index}]: chunk ${chunkIdx + 1}/${totalChunks} failed (HTTP ${chunkResponse.status})`);
          }
          if (!chunkResponse.body) {
            throw new Error(`file_urls[${index}]: chunk ${chunkIdx + 1}/${totalChunks} returned an empty body`);
          }
          yield* Readable.fromWeb(chunkResponse.body as import('stream/web').ReadableStream<Uint8Array>);
        }
      })());

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
    file_id: entry.file_id,
  };
}

// dedup() is in lib/storage/dedup.ts (shared with upload-helper.ts)

// ─── Batch download with reference-safe cleanup ──────────────────────────────

/**
 * Release FileCache references acquired by downloadFileUrl/dedup.
 * Canonical objects may be shared, so callers must decrement refCount instead
 * of deleting s3Key directly; cleanupExpiredCache applies the configured TTL.
 */
export interface ReleaseDownloadedFileReferencesOptions {
  /** Best-effort cleanup is appropriate in finally blocks; strict mode propagates errors. */
  bestEffort?: boolean;
}

export async function releaseDownloadedFileReferences(
  files: readonly DownloadedFile[],
  options: ReleaseDownloadedFileReferencesOptions = {},
): Promise<void> {
  const fileCacheIds = files.flatMap((file) => file.fileCacheId ? [file.fileCacheId] : []);
  if (fileCacheIds.length === 0) return;

  const bestEffort = options.bestEffort ?? true;
  if (bestEffort) {
    for (const fileCacheId of fileCacheIds) {
      await db.update(fileCaches)
        .set({ refCount: sql`GREATEST(${fileCaches.refCount} - 1, 0)` })
        .where(eq(fileCaches.id, fileCacheId))
        .catch(() => undefined);
    }
    return;
  }

  // Strict mode is all-or-nothing, so a failed batch can be retried safely.
  await db.transaction(async (tx) => {
    for (const fileCacheId of fileCacheIds) {
      await tx.update(fileCaches)
        .set({ refCount: sql`GREATEST(${fileCaches.refCount} - 1, 0)` })
        .where(eq(fileCaches.id, fileCacheId));
    }
  });
}

const MAX_CONCURRENT_DOWNLOADS = 5;

export async function downloadAllFileUrls(
  entries: FileUrlEntry[],
  operationId: string,
  authConfig?: FileUrlAuthConfig,
  allowedExtsStr?: string,
): Promise<DownloadedFile[]> {
  const results: DownloadedFile[] = [];

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
        await releaseDownloadedFileReferences(batchSuccesses, { bestEffort: false });
        throw firstError;
      }

      results.push(...batchSuccesses);
    }
  } catch (err) {
    await releaseDownloadedFileReferences(results, { bestEffort: false });
    throw err;
  }

  return results;
}
