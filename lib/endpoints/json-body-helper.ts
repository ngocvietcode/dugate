// lib/endpoints/json-body-helper.ts
// Helper to detect JSON body mode and resolve response content path with array index support.
// Convention: If extraHeaders contains "Content-Type: application/json", the connection
// uses JSON body mode. The `defaultPrompt` field stores a JSON template with {{placeholder}}.

/**
 * Check if a connection is configured for JSON body mode (legacy detection).
 * Signal: extraHeaders includes Content-Type: application/json
 * @deprecated Use isAiHubMode() for new code
 */
export function isJsonBodyMode(extraHeaders: string | null): boolean {
  if (!extraHeaders) return false;
  try {
    const parsed = JSON.parse(extraHeaders) as Record<string, string>;
    const ctKey = Object.keys(parsed).find(k => k.toLowerCase() === 'content-type');
    if (!ctKey) return false;
    return parsed[ctKey].toLowerCase().includes('application/json');
  } catch {
    return false;
  }
}

/**
 * Check if a connection is explicitly configured as AI Hub mode.
 * Signal: extraHeaders contains "X-Connection-Mode": "AIHUB"
 * This is the ONLY way to activate AI Hub logic — connections without this marker
 * will ALWAYS use legacy multipart form-data behavior.
 */
export function isAiHubMode(extraHeaders: string | null): boolean {
  if (!extraHeaders) return false;
  try {
    const parsed = JSON.parse(extraHeaders) as Record<string, string>;
    return parsed['X-Connection-Mode'] === 'AIHUB';
  } catch {
    return false;
  }
}

/**
 * Build JSON body from a template string, replacing {{placeholder}} markers with values.
 * The template is stored in `defaultPrompt` field.
 * 
 * Supports multiple placeholders:
 * - {{promptFieldName}} is replaced by the dynamic user input (value param)
 * - Additional placeholders from staticFields (e.g. {{system_prompt}}) are replaced by their values
 * 
 * @param template - JSON string with {{placeholder}} markers
 * @param placeholderName - The primary placeholder name (from promptFieldName), e.g. "user_prompt"
 * @param value - The dynamic value to inject for the primary placeholder
 * @param staticFields - Optional static key-value pairs for additional placeholders (from staticFormFields)
 * @returns The final JSON string ready to send
 */
/**
 * Set (or add) a top-level string field on an OpenAI-compatible JSON body.
 * Used to guarantee a value (e.g. an overridden `reasoning_effort`) is present
 * even when the connector's stored template has no placeholder for it.
 * Returns the body unchanged when it can't be parsed as a JSON object.
 */
export function setJsonBodyField(jsonBody: string, key: string, value: string): string {
  try {
    const parsed = JSON.parse(jsonBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonBody;
    parsed[key] = value;
    return JSON.stringify(parsed);
  } catch {
    return jsonBody;
  }
}

export function buildJsonBody(
  template: string,
  placeholderName: string,
  value: string,
  staticFields?: Array<{ key: string; value: string }> | null,
): string {
  let result = template;

  // Replace static field placeholders first (e.g. {{system_prompt}}, {{model}})
  if (staticFields && staticFields.length > 0) {
    for (const field of staticFields) {
      const placeholder = `{{${field.key}}}`;
      const escapedValue = JSON.stringify(field.value).slice(1, -1);
      result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), escapedValue);
    }
  }

  // Replace the primary dynamic placeholder (user input)
  const primaryPlaceholder = `{{${placeholderName}}}`;
  const escapedPrimaryValue = JSON.stringify(value).slice(1, -1);
  result = result.replace(new RegExp(escapeRegex(primaryPlaceholder), 'g'), escapedPrimaryValue);

  return result;
}

/**
 * Inject file(s) as base64 multimodal content into an OpenAI-compatible JSON body.
 * Converts the last user message's `content` from a string to a ContentPart array
 * with text + image_url entries.
 * 
 * If no files are provided, returns the jsonBody unchanged.
 * Supports image types (png, jpg, gif, webp, bmp, tiff) and PDF.
 * 
 * @param jsonBody - The JSON body string (already has placeholders replaced)
 * @param files - Array of File objects to inject
 * @returns The modified JSON body string with multimodal content
 */
export async function injectMultimodalFiles(jsonBody: string, files: File[]): Promise<string> {
  if (!files || files.length === 0) return jsonBody;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    return jsonBody; // Can't parse, return as-is
  }

  // Find the last user message in messages array
  if (!parsed.messages || !Array.isArray(parsed.messages)) return jsonBody;

  const lastUserIdx = parsed.messages.map((m: any, i: number) => m.role === 'user' ? i : -1)
    .filter((i: number) => i >= 0)
    .pop();

  if (lastUserIdx === undefined || lastUserIdx < 0) return jsonBody;

  const userMsg = parsed.messages[lastUserIdx];
  
  // Build content parts array
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [];

  // Add existing text content
  if (typeof userMsg.content === 'string') {
    contentParts.push({ type: 'text', text: userMsg.content });
  } else if (Array.isArray(userMsg.content)) {
    // Already multimodal, append files to existing array
    contentParts.push(...userMsg.content);
  }

  // Convert each file to appropriate content part based on type:
  // - Text files (.txt, .md, .csv, .json, .xml, .html) → inline text part
  // - Images & PDFs → image_url base64 part
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const mimeType = detectMimeType(file.name, file.type);

    if (isTextFile(file.name, mimeType)) {
      // Text-based files: inject as inline text content (not image_url)
      const textContent = Buffer.from(buffer).toString('utf-8');
      contentParts.push({
        type: 'text',
        text: `[File: ${file.name}]\n${textContent}`,
      });
    } else {
      // Binary files (images, PDFs): inject as image_url base64
      const base64 = Buffer.from(buffer).toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      contentParts.push({
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'auto' },
      });
    }
  }

  // Replace user message content with multimodal array
  parsed.messages[lastUserIdx].content = contentParts;

  return JSON.stringify(parsed);
}

/**
 * Detect MIME type from filename extension or fallback to provided type.
 */
function detectMimeType(filename: string, providedType?: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    // Images — aligned with Gemini 2.5 vision support
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'htm': 'text/html',
  };
  if (ext && mimeMap[ext]) return mimeMap[ext];
  if (providedType && providedType !== 'application/octet-stream') return providedType;
  return 'image/png';
}

/**
 * Determine if a file should be treated as text (inline) vs binary (image_url).
 * Text files are injected as inline text content parts so they don't trigger
 * "invalid image" errors on vision-capable models like Gemini.
 */
function isTextFile(filename: string, mimeType: string): boolean {
  const textExtensions = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'yaml', 'yml', 'log', 'ini', 'cfg', 'toml'];
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && textExtensions.includes(ext)) return true;
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'application/json' || mimeType === 'application/xml') return true;
  return false;
}

/**
 * Strip a leading/trailing markdown code fence (```json ... ``` or ``` ... ```)
 * from a string, returning the inner content trimmed. If the input is not wrapped
 * in a code fence, it is returned unchanged. Idempotent on already-stripped text.
 *
 * Examples:
 *   "```json\n{\"a\":1}\n```"  → '{"a":1}'
 *   "```\n{\"a\":1}\n```"      → '{"a":1}'
 *   "{\"a\":1}"                → '{"a":1}'
 */
export function stripMarkdownCodeFence(raw: string): string {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  // Match an opening fence (with optional language tag) and a closing fence.
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Resolve a dot-path on a JSON object, supporting numeric segments as array indices.
 * Example: "choices.0.message.content" → obj.choices[0].message.content
 */
export function resolveContentPath(obj: unknown, path: string | null | undefined): unknown {
  const contentPath = path?.trim();
  if (!contentPath) {
    return typeof obj === 'object' && obj !== null ? JSON.stringify(obj, null, 2) : String(obj);
  }

  let current: unknown = obj;
  for (const part of contentPath.split('.')) {
    if (current === null || current === undefined) break;
    // If part is a number and current is an array, use as index
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  if (current === undefined || current === null) return null;
  return typeof current === 'object' ? JSON.stringify(current, null, 2) : String(current);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
