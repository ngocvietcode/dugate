// lib/pipelines/processors/http-client.ts
// HTTP client wrapper for external API calls: SSRF protection, redacted logging, timeout.

import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { BEARER_PATTERN, SECRET_KEY_PATTERN } from '@/lib/log-sanitize';
import type { Logger } from '@/lib/logger';

// Headers safe to log verbatim — all others are redacted
const SAFE_LOG_HEADERS = new Set(['accept', 'content-type']);

/** Strip credentials, query parameters, and fragments before a URL reaches logs. */
export function sanitizeUrlForLogging(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Rebuild from scheme + host + path only: userinfo, query and fragment are
    // dropped by construction, so no sensitive value can survive into a log line.
    // `host` carries hostname+port but never userinfo. Deliberately NOT `origin`:
    // origin is the string "null" for non-special schemes, which would hide the
    // scheme of a misconfigured URL in the blocked-origin warning paths.
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Exact-origin allowlist check for sensitive outbound destinations.
 *
 * Opt-in semantics: when `configuredOrigins` is empty/unset the allowlist is NOT
 * enforced and any already-SSRF-validated URL is permitted. This preserves the
 * pre-hardening behaviour for deployments that have not configured the allowlist,
 * so enabling the security control is an explicit opt-in. Provide a
 * comma-separated list of exact origins to switch into enforced mode.
 */
export function isUrlOriginAllowed(rawUrl: string, configuredOrigins: string): boolean {
  const allowed = configuredOrigins
    .split(',')
    .map((configured) => configured.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true; // unconfigured → allow (opt-in hardening)
  let origin: string;
  try { origin = new URL(rawUrl).origin; } catch { return false; }
  return allowed.some((configured) => {
    try { return new URL(configured).origin === origin; } catch { return false; }
  });
}

/** JSON requests may contain prompts, document text, model IDs and base64 files. */
function redactJsonBody(body: string): string {
  return `<REDACTED_JSON_BODY chars=${body.length}>`;
}

/** How much of a provider error body is kept for operator diagnostics. */
export const MAX_ERROR_BODY_CHARS = 500;

// SECRET_KEY_PATTERN / BEARER_PATTERN now live in lib/log-sanitize.ts (plan T3.2)
// so the Logger's SECRET layer and summarizeErrorBody() share ONE definition —
// a credential shape added in one place is covered in both.
// Re-exported for the existing tests/importers that reference them from here.
export { SECRET_KEY_PATTERN, BEARER_PATTERN };

/**
 * Turn a provider error body into a short, secret-free excerpt that is safe to
 * put into an operator-visible error message.
 *
 * Kept deliberately simple: redact credential-shaped values, collapse
 * whitespace, then truncate. The goal is "why did the provider reject this",
 * not a full transcript — the full body length is logged separately.
 */
export function summarizeErrorBody(raw: string): string {
  if (!raw) return '';
  const redacted = raw
    .replace(SECRET_KEY_PATTERN, '$1"***"')
    .replace(BEARER_PATTERN, '$1 ***')
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted) return '';
  return redacted.length > MAX_ERROR_BODY_CHARS
    ? `${redacted.slice(0, MAX_ERROR_BODY_CHARS)}… (truncated)`
    : redacted;
}

/**
 * A non-2xx response from an external API.
 *
 * Carries the HTTP status so callers can tell a *configuration* failure (4xx —
 * wrong model, wrong prompt shape, bad credential) apart from a *transport /
 * provider* failure (5xx, DNS, timeout, socket reset). Before this existed every
 * failure collapsed into one generic "Connection Error", which hid the provider's
 * own explanation (e.g. "model not found") from operators.
 */
export class ExternalApiHttpError extends Error {
  readonly status: number;
  /** Redacted, truncated provider response body. Empty when the body was unreadable. */
  readonly bodyExcerpt: string;
  /** Length of the original body, for logs (the excerpt may be truncated). */
  readonly bodyLength: number;

  constructor(status: number, bodyExcerpt: string, bodyLength: number, prefix?: string) {
    const head = prefix ?? `External API returned HTTP ${status}`;
    super(bodyExcerpt ? `${head}: ${bodyExcerpt}` : head);
    this.name = 'ExternalApiHttpError';
    this.status = status;
    this.bodyExcerpt = bodyExcerpt;
    this.bodyLength = bodyLength;
  }
}

/**
 * Log a curl-equivalent command for debugging.
 * Auth headers and form field/body values are always redacted.
 *
 * Accepts either a {@link FormData} body (multipart, rendered as `-F` flags) or
 * a JSON string body (AIHub mode, rendered as a single `-d` flag). For JSON
 * bodies, large base64 data URLs are redacted to keep the log readable and to
 * avoid leaking attachment contents.
 */
export function logCurlCommand(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: FormData | string,
  logger: Logger,
) {
  let curl = `curl -X ${method} "${sanitizeUrlForLogging(url)}" \\\n`;
  for (const k of Object.keys(headers)) {
    const val = SAFE_LOG_HEADERS.has(k.toLowerCase()) ? headers[k] : '***';
    curl += `  -H "${k}: ${val}" \\\n`;
  }

  if (typeof body === 'string') {
    // Never log JSON values; metadata is sufficient for diagnostics.
    curl += `  -d '${redactJsonBody(body)}' \\\n`;
  } else {
    try {
      (body as any).forEach((value: any, key: string) => {
        if (typeof value === 'object' && value !== null && 'size' in value) {
          curl += `  -F "${key}=@/path/to/file" \\\n`;
        } else {
          curl += `  -F "${key}=***" \\\n`;
        }
      });
    } catch (_e) { /* FormData.entries() may not be available in all environments */ }
  }

  curl = curl.trim().replace(/\\$/, '');
  logger.debug(`[cURL COMMAND]\n${curl}`);
}

/** Normalize URL.hostname output for IP checks and explicit host allowlists. */
function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unbracketed.replace(/\.$/, '').toLowerCase();
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((part) => part >= 0 && part <= 255) ? octets : null;
}

/** Block non-public IPv4 ranges, including documentation and carrier-grade NAT ranges. */
function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return true;
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseIpv6(ip: string): number[] | null {
  const withoutZone = ip.split('%')[0] ?? ip;
  let normalized = withoutZone.toLowerCase();
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

/** Block every IPv6 range that is not ordinary public unicast plus known reserved ranges. */
function isPrivateIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return true;
  const isUnspecifiedOrLoopback = bytes.slice(0, 15).every((value) => value === 0);
  const isIpv4Mapped = bytes.slice(0, 10).every((value) => value === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIpv4Mapped) return isPrivateIpv4(bytes.slice(12).join('.'));
  if (isUnspecifiedOrLoopback) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if ((bytes[0] & 0xe0) !== 0x20) return true; // outside 2000::/3 global unicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateIpv4(bytes.slice(2, 6).join('.')); // 6to4 embeds an IPv4 destination
  }
  return false;
}

/** Check whether an IP literal is private, local, or otherwise non-routable. */
function isPrivateIp(ip: string): boolean {
  const normalized = normalizeHostname(ip);
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);
  return true;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || (isIP(normalized) > 0 && isPrivateIp(normalized));
}

interface ResolvedSafeUrl {
  url: string;
  hostname: string;
  address?: string;
  family?: 4 | 6;
  /** All validated DNS answers, in resolver order. */
  addresses?: Array<{ address: string; family: 4 | 6 }>;
}

async function resolveSafeUrl(rawUrl: string): Promise<ResolvedSafeUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid external URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed URL scheme '${parsed.protocol}' — only http/https are permitted`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials embedded in URLs are not permitted');
  }

  const hostname = normalizeHostname(parsed.hostname);
  const allowedPrivateHosts = (process.env.ALLOWED_PRIVATE_HOSTS ?? '')
    .split(',')
    .map((host) => normalizeHostname(host.trim()))
    .filter(Boolean);
  const isTrusted = allowedPrivateHosts.includes(hostname);

  if (!isTrusted && isPrivateHostname(hostname)) {
    throw new Error(`SSRF protection: hostname '${hostname}' is private or reserved`);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily > 0) {
    return { url: parsed.toString(), hostname };
  }

  let addresses: Array<{ address: string; family: 4 | 6 }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true }) as Array<{ address: string; family: 4 | 6 }>;
  } catch {
    throw new Error(`SSRF protection: failed to resolve hostname '${hostname}'`);
  }
  if (addresses.length === 0 || (!isTrusted && addresses.some(({ address }) => isPrivateIp(address)))) {
    throw new Error(`SSRF protection: hostname '${hostname}' resolves to a private or reserved address`);
  }

  // Every answer is validated, so all of them can be pinned. Handing the full set
  // to the agent keeps Node's Happy Eyeballs fallback working: pinning only
  // addresses[0] would hard-fail whenever DNS returns an AAAA record first on a
  // network without IPv6 egress, even though a usable IPv4 answer exists.
  const selected = addresses[0];
  return {
    url: parsed.toString(),
    hostname,
    address: selected.address,
    family: selected.family,
    addresses,
  };
}

/** Validate URL syntax and every current DNS answer. */
export async function assertSafeUrl(rawUrl: string): Promise<string> {
  return (await resolveSafeUrl(rawUrl)).url;
}

export interface SsrfSafeFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: FormData | string;
  signal?: AbortSignal;
}

/**
 * Execute a request through a per-request Node Agent pinned to the validated DNS
 * address. This closes the DNS preflight/fetch TOCTOU gap while preserving the
 * original hostname for Host and TLS SNI. Redirects remain manual.
 */
export async function ssrfSafeFetch(rawUrl: string, init: SsrfSafeFetchInit = {}): Promise<Response> {
  const resolved = await resolveSafeUrl(rawUrl);
  const parsed = new URL(resolved.url);
  const headers = new Headers(init.headers);
  let bodyStream: Readable | null = null;
  let stringBody: string | undefined;

  if (typeof init.body === 'string') {
    stringBody = init.body;
    if (!headers.has('content-length')) headers.set('content-length', String(Buffer.byteLength(stringBody)));
  } else if (init.body instanceof FormData) {
    const encoded = new Response(init.body);
    const contentType = encoded.headers.get('content-type');
    if (contentType && !headers.has('content-type')) headers.set('content-type', contentType);
    if (encoded.body) bodyStream = Readable.fromWeb(encoded.body as import('node:stream/web').ReadableStream);
  }

  // The pinned lookup must honour BOTH callback shapes Node may ask for:
  //   - options.all === true  → callback(null, [{ address, family }])
  //   - otherwise             → callback(null, address, family)
  // Node >= 20 enables Happy Eyeballs (`autoSelectFamily`) by default, so
  // net.connect calls this hook with `all: true`. Answering with the 3-argument
  // form there makes Node read addresses[0] from a string and abort the socket
  // with `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`, which fails
  // every outbound connector call that resolves through DNS.
  const lookup: http.AgentOptions['lookup'] = resolved.address && resolved.family
    ? ((_hostname: string, options: { all?: boolean } | undefined, callback: (...args: unknown[]) => void) => {
        if (options && typeof options === 'object' && options.all) {
          callback(null, resolved.addresses ?? [{ address: resolved.address!, family: resolved.family! }]);
          return;
        }
        callback(null, resolved.address!, resolved.family!);
      }) as unknown as http.AgentOptions['lookup']
    : undefined;
  const agent = parsed.protocol === 'https:'
    ? new https.Agent({ lookup })
    : new http.Agent({ lookup });
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(parsed, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      agent,
      signal: init.signal,
    }, (response) => {
      const cleanup = () => agent.destroy();
      response.once('end', cleanup);
      response.once('close', cleanup);
      try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, String(value));
        }
        const status = response.statusCode ?? 500;
        const hasNullBody = (init.method ?? 'GET').toUpperCase() === 'HEAD'
          || status === 204 || status === 205 || status === 304;
        const responseBody = hasNullBody
          ? null
          : Readable.toWeb(response) as ReadableStream<Uint8Array>;
        if (hasNullBody) response.resume();
        resolve(new Response(responseBody, {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      } catch (error) {
        response.destroy();
        agent.destroy();
        reject(error);
      }
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      agent.destroy();
      reject(new Error('HTTP protocol upgrade is not permitted'));
    });
    request.on('error', (error) => {
      agent.destroy();
      reject(error);
    });
    if (bodyStream) {
      bodyStream.on('error', (error) => request.destroy(error));
      bodyStream.pipe(request);
    } else {
      request.end(stringBody);
    }
  });
}

/**
 * Read a failed response body once and turn it into an {@link ExternalApiHttpError}.
 *
 * The body is ALWAYS consumed (the socket must be drained) but — unlike the
 * previous implementation — the content is no longer thrown away: it is the only
 * place the provider explains itself ("model not found", "prompt too long",
 * "quota exceeded"). It is redacted and truncated before it becomes part of the
 * message.
 */
async function buildHttpError(response: Response, prefix?: string): Promise<ExternalApiHttpError> {
  const rawBody = await response.text().catch(() => '');
  return new ExternalApiHttpError(
    response.status,
    summarizeErrorBody(rawBody),
    rawBody.length,
    prefix,
  );
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
    const response = await ssrfSafeFetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await buildHttpError(response);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw await buildHttpError(
        response,
        `External API returned non-JSON response (Content-Type: ${contentType || 'none'})`,
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

/**
 * Execute an HTTP request with a JSON string body and a timeout, returning the
 * parsed JSON response. Mirrors {@link fetchWithTimeout} but sends a string body
 * with `Content-Type: application/json` (used by the AIHub branch).
 * Throws on HTTP errors, non-JSON responses, timeouts, and network failures.
 */
export async function fetchJsonWithTimeout(
  url: string,
  method: string,
  headers: Record<string, string>,
  jsonBody: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  // Copy headers so we never mutate the caller's object, and ensure JSON content type.
  const requestHeaders: Record<string, string> = { ...headers, 'Content-Type': 'application/json' };

  try {
    const response = await ssrfSafeFetch(url, {
      method,
      headers: requestHeaders,
      body: jsonBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await buildHttpError(response);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw await buildHttpError(
        response,
        `External API returned non-JSON response (Content-Type: ${contentType || 'none'})`,
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
