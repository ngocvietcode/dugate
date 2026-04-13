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
    (formData as any).forEach((value: any, key: string) => {
      if (typeof value === 'object' && value !== null && 'size' in value) {
        curl += `  -F "${key}=@/path/to/file" \\\n`;
      } else {
        curl += `  -F "${key}=***" \\\n`;
      }
    });
  } catch (_e) { /* FormData.entries() may not be available in all environments */ }

  curl = curl.trim().replace(/\\$/, '');
  logger.info(`[cURL COMMAND]\n${curl}`);
}

/**
 * Check if an IP address is private/reserved.
 */
function isPrivateIp(ip: string): boolean {
  const patterns = [
    /^127\./,                          // IPv4 loopback
    /^10\./,                           // RFC 1918
    /^192\.168\./,                     // RFC 1918
    /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918
    /^169\.254\./,                     // Link-local
    /^0\./,                            // Current network
    /^0\.0\.0\.0$/,
    /^::1$/,                           // IPv6 loopback
    /^::$/,                            // IPv6 all-zeros
    /^::ffff:127\./i,                  // IPv4-mapped IPv6 loopback
    /^::ffff:10\./i,                   // IPv4-mapped RFC 1918
    /^::ffff:192\.168\./i,             // IPv4-mapped RFC 1918
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped RFC 1918
    /^::ffff:169\.254\./i,             // IPv4-mapped link-local
    /^fc[0-9a-f]{2}:/i,               // IPv6 unique local
    /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
    /^fe80:/i,                         // IPv6 link-local
  ];
  return patterns.some((p) => p.test(ip));
}

/**
 * Check if a hostname is private/reserved (string-level check before DNS resolution).
 */
function isPrivateHostname(hostname: string): boolean {
  return /^localhost$/i.test(hostname) || isPrivateIp(hostname);
}

/**
 * Validate that a URL is safe to call (SSRF protection).
 * Returns the (potentially rewritten) safe URL, or throws on violation.
 *
 * Protections:
 * - Blocks private/reserved hostnames and IPs (string check)
 * - Resolves DNS and blocks private resolved IPs (prevents DNS rebinding)
 * - Does NOT follow redirects — caller must handle manually
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

  if (isPrivateHostname(hostname)) {
    throw new Error(`SSRF protection: URL hostname '${hostname}' is a private/reserved address`);
  }

  // DNS resolution check — prevents DNS rebinding attacks
  // Skip for IP addresses (they were already checked above)
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[');
  if (!isIpLiteral) {
    try {
      const dns = await import('dns');
      const { address } = await dns.promises.lookup(hostname);
      if (isPrivateIp(address)) {
        throw new Error(`SSRF protection: hostname '${hostname}' resolves to private IP '${address}'`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('SSRF protection')) throw err;
      // DNS resolution failed — block the request (fail-closed)
      throw new Error(`SSRF protection: failed to resolve hostname '${hostname}'`);
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

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '(unreadable)');
      throw new Error(
        `External API returned non-JSON response (Content-Type: ${contentType || 'none'}): ${text.substring(0, 200)}`,
      );
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
