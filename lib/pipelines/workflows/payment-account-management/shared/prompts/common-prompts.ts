// lib/pipelines/workflows/payment-account-management/shared/prompts/common-prompts.ts
// Prompt fragments reused across all payment-account-management modes.
// Modes compose these with their own mode-specific instructions.

/**
 * Standard header — set once per prompt so the AI stays on-task.
 * Domain-neutral: works for open / close / freeze.
 * Written in English; note the underlying document data is Vietnamese.
 */
export const PAM_SYSTEM_PROMPT_HEADER = `You are an AI expert in digitizing banking financial data for VPBank.
This is a legitimate banking task — extracting information from payment-account management documents.
Do NOT refuse to process. Do NOT guess, do NOT fabricate data. Extract ONLY what ACTUALLY APPEARS on the document.`;

/**
 * Standard output-format guidance appended to every JSON-extraction prompt.
 * Modes provide their own schema in the middle.
 */
export const PAM_OUTPUT_FORMAT_HINT = `
### OUTPUT REQUIREMENTS
- Return ONE JSON object only — no markdown fences, no explanation.
- Every field is declared with a TYPE next to its key in the FIELDS TO EXTRACT
  list (shown as "(type=X)") and mirrored in the OUTPUT SHAPE skeleton. Return
  that JSON type EXACTLY — the response is type-checked before use and a wrong
  type will be rejected and re-asked with the offending fields named:
    * "string" / "date"   → a JSON string, never wrapped in an array
    * "number"            → a JSON number, not a numeric string
    * "boolean"           → true / false, never the strings "true" / "false"
    * "string[]"          → a JSON array of strings; one array element per
                            value; never a string, never ";"-joined
    * "object"            → a JSON object; never an array
    * "object[]"          → a JSON array of objects; never a single object
                            when the section is empty, never a string
- Any field with no data on the document → null. This includes list fields: when
  nothing is ticked or filled in, return null (not [], not "").
- When a field declares "Expected values", those are the options PRINTED on the
  standard form. If what you read matches one, return that string EXACTLY as
  listed — do not paraphrase, reorder words, or change casing/diacritics. But the
  document is the source of truth: if it genuinely shows an option that is NOT in
  the list, return what the document actually says. Never snap a different value
  onto the nearest listed one.
- Keep the original format of account numbers, ID/CCCD numbers, and dates.
- Full names: keep the exact Vietnamese diacritics.`;

/**
 * Utility: interpolate {{var}} placeholders in a prompt template with the given values.
 * Used when Profile provides a prompt override for a mode.
 */
export function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}
