// lib/pipelines/processors/http-client.ts
// HTTP client wrapper for external API calls: SSRF protection, redacted logging, timeout.

import type { Logger } from '@/lib/logger';

// Headers safe to log verbatim — all others are redacted
const SAFE_LOG_HEADERS = new Set(['accept', 'content-type']);

/**
 * Log a curl-equivalent command for debugging.
 * Auth headers and form field values are always redacted.
 */
export function logCurlCommand(
  url: string,
  method: string,
  headers: Record<string, string>,
  formData: FormData,
  logger: Logger,
) {
  let curl = `curl -X ${method} "${url}" \\\n`;
  for (const k of Object.keys(headers)) {
    const val = SAFE_LOG_HEADERS.has(k.toLowerCase()) ? headers[k] : '***';
    curl += `  -H "${k}: ${val}" \\\n`;
  }

  try {
    for (const [key, value] of (formData as unknown as Iterable<[string, unknown]>)) {
      if (typeof value === 'object' && value !== null && 'size' in value) {
        curl += `  -F "${key}=@/path/to/file" \\\n`;
      } else {
        curl += `  -F "${key}=***" \\\n`;
      }
    }
  } catch (_e) { /* FormData.entries() may not be available in all environments */ }

  curl = curl.trim().replace(/\\$/, '');
  logger.info(`[cURL COMMAND]\n${curl}`);
}

/**
 * Validate that a URL is safe to call (SSRF protection).
 * Returns the (potentially rewritten) safe URL, or throws on violation.
 */
export async function assertSafeUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid external API URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed URL scheme '${parsed.protocol}' — only http/https are permitted`);
  }

  const hostname = parsed.hostname;

  // Allow Docker internal host substitution for local dev/Docker environments
  if (process.env.UPLOAD_DIR === '/app/uploads' && hostname === 'localhost') {
    parsed.hostname = 'host.docker.internal';
    return parsed.toString();
  }

  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^::1$/,
    /^fc[0-9a-f]{2}:/i,
    /^fd[0-9a-f]{2}:/i,
    /^0\./,
    /^0\.0\.0\.0$/,
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`SSRF protection: URL hostname '${hostname}' is a private/reserved address`);
    }
  }

  return parsed.toString();
}

/**
 * Execute an HTTP request with a timeout and return the parsed JSON response.
 * Throws on HTTP errors, timeouts, and network failures.
 */
export async function fetchWithTimeout(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: FormData,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new Error(`External API returned HTTP ${response.status}: ${errorBody.substring(0, 500)}`);
    }

    return await response.json();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`External API timeout after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
