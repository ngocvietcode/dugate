// lib/pipelines/processors/prompt-resolver.ts
// Prompt resolution and {{variable}} interpolation for external API calls.

import type { ExternalApiConnection, ExternalApiOverride } from '@/lib/db/schema';

/**
 * Interpolate {{variable}} placeholders in a template string.
 * e.g. "Hello {{name}}" with { name: "An" } => "Hello An"
 */
export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const strValue = typeof value === 'object' && value !== null 
      ? JSON.stringify(value) 
      : String(value);
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strValue);
  }
  return result;
}

/**
 * Resolve the effective prompt for a connector call.
 * Priority: code-injected _prompt > profile override > connector default.
 */
export function resolvePrompt(
  variables: Record<string, unknown>,
  connection: ExternalApiConnection,
  override?: ExternalApiOverride | null,
): string {
  const rawPrompt =
    typeof variables._prompt === 'string'
      ? variables._prompt
      : override?.promptOverride?.trim()
      ? override.promptOverride
      : connection.defaultPrompt;

  return interpolateVariables(rawPrompt, variables);
}
