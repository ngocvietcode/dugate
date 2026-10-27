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

/**
 * The static form field key that carries the AI model name.
 * Consistent with AIHub config (lib/endpoints/aihub-config.ts) and seed data.
 */
export const MODEL_FIELD_KEY = 'model';

/**
 * Resolve the effective model OVERRIDE for a connector call.
 * Priority: code/workflow-injected `_model` > profile override (ExternalApiOverride.modelOverride).
 *
 * Returns the override string when one is present, or `null` to signal
 * "no override — use the connector's default model" (the `model` entry in
 * `staticFormFields`). Mirrors resolvePrompt's override semantics.
 */
export function resolveModel(
  variables: Record<string, unknown>,
  override?: ExternalApiOverride | null,
): string | null {
  if (typeof variables._model === 'string' && variables._model.trim()) {
    return variables._model.trim();
  }
  if (override?.modelOverride?.trim()) {
    return override.modelOverride.trim();
  }
  return null;
}

/**
 * Apply a resolved model override to a list of static form fields.
 * Replaces the `model` field's value when present; appends one when absent.
 * Returns the original array unchanged when `modelOverride` is null/empty.
 */
export function applyModelOverride(
  staticFields: Array<{ key: string; value: string }>,
  modelOverride: string | null,
): Array<{ key: string; value: string }> {
  if (!modelOverride) return staticFields;
  let found = false;
  const result = staticFields.map((f) => {
    if (f.key === MODEL_FIELD_KEY) {
      found = true;
      return { ...f, value: modelOverride };
    }
    return f;
  });
  if (!found) result.push({ key: MODEL_FIELD_KEY, value: modelOverride });
  return result;
}

/**
 * The static form field key that carries the OpenAI-compatible reasoning_effort.
 * Consistent with AIHub config (lib/endpoints/aihub-config.ts).
 */
export const REASONING_EFFORT_FIELD_KEY = 'reasoning_effort';

/**
 * Resolve the effective reasoning_effort OVERRIDE for a connector call.
 * Priority: code/workflow-injected `_reasoning_effort` > profile override
 * (ExternalApiOverride.reasoningEffortOverride).
 *
 * Returns the override string when one is present, or `null` to signal
 * "no override — use the connector's default reasoning_effort" (the
 * `reasoning_effort` entry in `staticFormFields`, if any). Mirrors resolveModel.
 */
export function resolveReasoningEffort(
  variables: Record<string, unknown>,
  override?: ExternalApiOverride | null,
): string | null {
  if (typeof variables._reasoning_effort === 'string' && variables._reasoning_effort.trim()) {
    return variables._reasoning_effort.trim();
  }
  if (override?.reasoningEffortOverride?.trim()) {
    return override.reasoningEffortOverride.trim();
  }
  return null;
}

/**
 * Apply a resolved reasoning_effort override to a list of static form fields.
 * Replaces the `reasoning_effort` field's value when present; appends one when
 * absent. Returns the original array unchanged when `override` is null/empty.
 */
export function applyReasoningEffortOverride(
  staticFields: Array<{ key: string; value: string }>,
  reasoningEffortOverride: string | null,
): Array<{ key: string; value: string }> {
  if (!reasoningEffortOverride) return staticFields;
  let found = false;
  const result = staticFields.map((f) => {
    if (f.key === REASONING_EFFORT_FIELD_KEY) {
      found = true;
      return { ...f, value: reasoningEffortOverride };
    }
    return f;
  });
  if (!found) result.push({ key: REASONING_EFFORT_FIELD_KEY, value: reasoningEffortOverride });
  return result;
}
