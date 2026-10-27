// lib/pipelines/processors/response-parser.ts
// Utilities for extracting content from external API JSON responses.

/**
 * Resolve a value by dot-path in a JSON object.
 * e.g. resolveDotPath({ data: { response: "hello" } }, "data.response") => "hello"
 */
export function resolveDotPath(obj: unknown, dotPath: string): unknown {
  if (!dotPath || obj === null || obj === undefined) return obj;
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Extract the primary content string from a parsed API response.
 * Falls back to full JSON if the configured path is not found.
 */
export function extractContent(
  responseJson: unknown,
  contentPath: string,
  onMiss: (path: string) => void,
): string {
  const rawContent = resolveDotPath(responseJson, contentPath);

  if (typeof rawContent === 'string') {
    return rawContent;
  } else if (rawContent !== null && rawContent !== undefined) {
    return JSON.stringify(rawContent);
  } else {
    onMiss(contentPath);
    return JSON.stringify(responseJson);
  }
}
