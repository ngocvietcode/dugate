// lib/pipelines/workflows/payment-account-management/shared/prompts/doc-prompts.ts
// Shared prompt builders for the AI steps (reused by open / update / ... modes):
//   - buildClassifyPrompt              — classify one document into a type code.
//   - buildSplitClassifySystemPrompt   — static system prompt for the split classifier.
//   - renderSplitPrompt                — render the split-classify messages thread.
//   - buildExtractSystemPrompt         — static system prompt for a single-call schema.
//   - buildExtractSystemPromptForGroup — static system prompt for ONE group of a
//                                        multi-call schema (see MultiCallExtractSchema).
//   - renderExtractPrompt              — render the extract messages thread.
//
// Both extraction and split-classification use the same LangGraph-style retry
// pattern: build the static "system" prompt once, then feed it into a growing
// messages thread the engine re-renders on each retry attempt. See
// classify-engine.ts::classifyDocumentSegments and extract-engine.ts for the
// retry loops that drive these builders.
//
// The document taxonomy is passed in, so these are mode-agnostic.

import {
  PAM_SYSTEM_PROMPT_HEADER,
  PAM_OUTPUT_FORMAT_HINT,
  interpolatePrompt,
} from './common-prompts';
import { type ExtractSchemaGroup, type FieldSpec, fieldTypeOf } from '../schemas';
import { type DocumentType, parseSlots, SLOT_FIELD_MAP } from '../documents';

/**
 * Render the taxonomy as a numbered list the LLM can read.
 * For each type we show: code, keyword indicators, disambiguation rules, and
 * (only when the title has <slot>s) which `fields` keys to extract for it.
 */
function buildTaxonomyText(documents: DocumentType[]): string {
  return documents.map((doc, i) => {
    // Turn the title's <slot> labels into the field keys the LLM must return.
    const slots = parseSlots(doc.title);
    const fieldKeys = [...new Set(slots.map((s) => SLOT_FIELD_MAP[s]).filter(Boolean))];
    const fieldsLine =
      fieldKeys.length > 0
        ? `\n   - fields to extract: ${fieldKeys.join(', ')}`
        : '\n   - fields: {} (this type needs no field extraction)';

    return (
      `${i + 1}. code: "${doc.code}"\n` +
      `   - indicators: ${doc.indicators.join(', ')}\n` +
      `   - description: ${doc.description}` +
      fieldsLine
    );
  }).join('\n\n');
}

/**
 * Build the classifier prompt for a single document.
 * Returns { _prompt } so the connector uses this text instead of its DB default.
 *
 * @param documents      the document-type taxonomy to classify against
 * @param fileName       name of the file being classified (context for the LLM)
 * @param promptOverride optional Profile override; {{file_name}} is interpolated
 */
export function buildClassifyPrompt(
  documents: DocumentType[],
  fileName: string,
  promptOverride?: string,
): { _prompt: string } {
  // If the client configured a custom prompt, honor it (same pattern as other workflows).
  if (promptOverride && promptOverride.trim()) {
    return { _prompt: interpolatePrompt(promptOverride, { file_name: fileName }) };
  }

  const taxonomy = buildTaxonomyText(documents);

  // Note: the taxonomy descriptions come from documents.ts and are in Vietnamese
  // (that is the source data); all instructions are in English.
  const prompt = `${PAM_SYSTEM_PROMPT_HEADER}

### TASK
Classify the document "${fileName}" into EXACTLY ONE type from the catalog below.
Read each type's "description" carefully — it holds the rules to tell apart
look-alike types (e.g. MB02 vs MB04 differ by the word "CHUNG"; căn cước vs
căn cước công dân differ by the word "CÔNG DÂN").

### DOCUMENT TYPE CATALOG
${taxonomy}

### HOW TO FILL "fields"
- For a type that lists "fields to extract": read the document and put the REAL
  value for each key (e.g. ho_ten = the person's name, so_giay_to = the ID /
  passport / visa number).
- If a value cannot be read, use an empty string "".
- For a type marked "fields: {}": return an empty object {}.

### OUTPUT REQUIREMENTS
Return ONE JSON object only — no markdown, no extra text — in this exact shape:
{
  "code": "<a code from the catalog, or \\"unknown\\" if nothing matches>",
  "confidence": <number 0..1, how certain you are>,
  "reason": "<one short sentence: why you picked this code>",
  "fields": { ... }
}`;

  return { _prompt: prompt };
}

// ─── Split-aware classifier prompt (with retry-messages state) ────────────────────

/**
 * One entry in the LangGraph-style `messages` thread the split classifier keeps
 * per file across retry attempts.
 *   - system:    the base task prompt (built once, first entry).
 *   - assistant: the LLM's raw JSON response from a previous attempt.
 *   - error:     a validation problem the code found in that response — appended
 *                so the next attempt sees exactly what was wrong and self-corrects.
 */
export interface SplitMessage {
  role: 'system' | 'assistant' | 'error';
  content: string;
}

/**
 * Build the STATIC base prompt (the "system" message) for splitting one file into
 * page-ranged segments. Called ONCE per file — everything here is fixed across
 * retries, so only the messages thread grows (see renderSplitPrompt). This keeps
 * the dynamic input to a single thread instead of many changing parameters.
 *
 * Pages may be NON-CONTIGUOUS — a 2-sided ID card scanned onto pages 1 and 4 is
 * `pages: [1, 4]`, not a 1..4 range. The known page count bounds the model; the
 * code re-validates and retries on any out-of-bounds / overlap / gap.
 */
export function buildSplitClassifySystemPrompt(
  documents: DocumentType[],
  fileName: string,
  pageCount: number | null,
): string {
  const taxonomy = buildTaxonomyText(documents);
  // When the page count is unknown, do not assert a bound the model would trust.
  const pageCountLine =
    pageCount != null
      ? `This file has EXACTLY ${pageCount} page(s), numbered 1..${pageCount}.`
      : `The exact page count is unknown; number pages starting at 1 as you read them.`;

  return `${PAM_SYSTEM_PROMPT_HEADER}

### TASK
The file "${fileName}" is a single scan that may contain SEVERAL separate documents
concatenated together. ${pageCountLine}
Split it into its constituent documents. For EACH document, classify it into EXACTLY
ONE type from the catalog below AND list the exact page numbers it occupies.

IMPORTANT — pages may be NON-CONTIGUOUS. One physical document can be spread across
non-adjacent pages (e.g. the two sides of an ID card scanned onto page 1 and page 4,
with a different document on pages 2–3). List EVERY page that belongs to the document,
in reading order, even if they are not next to each other.

### DOCUMENT TYPE CATALOG
${taxonomy}

### PAGE ASSIGNMENT RULES
- Assign EVERY page (1..${pageCount ?? 'N'}) to EXACTLY ONE document — no page left out, no page in two documents.
- If the whole file is a single document, return ONE segment whose "pages" lists all pages.
- Use 1-based page numbers. Only use page numbers that actually exist in the file.

### HOW TO FILL "fields"
- For a type that lists "fields to extract": read that document and put the REAL
  value for each key (e.g. ho_ten = the person's name, so_giay_to = the ID number).
- If a value cannot be read, use an empty string "".
- For a type marked "fields: {}": return an empty object {}.

### OUTPUT REQUIREMENTS
Return ONE JSON object only — no markdown, no extra text — in this exact shape:
{
  "segments": [
    {
      "code": "<a code from the catalog, or \\"unknown\\" if nothing matches>",
      "confidence": <number 0..1, how certain you are>,
      "reason": "<one short sentence: why you picked this code>",
      "fields": { ... },
      "pages": [<1-based page numbers this document occupies, in reading order>]
    }
  ]
}`;
}

/**
 * Render the accumulated `messages` thread into a SINGLE prompt string (the one
 * dynamic parameter passed to the connector as `_prompt`). On the first attempt
 * this is just the system prompt; on retries it also shows the previous answer
 * and the validation error, then re-asks for a corrected JSON object.
 *
 * @param messages       the thread (system first, then assistant/error pairs)
 * @param fileName       used only when a Profile prompt override is present
 * @param promptOverride optional Profile override for the SYSTEM prompt; the
 *                       retry framing (previous answer + error) is still appended
 *                       so retries keep working even with a custom base prompt.
 */
export function renderSplitPrompt(
  messages: SplitMessage[],
  fileName: string,
  promptOverride?: string,
): { _prompt: string } {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      // Honor a Profile override for the base prompt only (same pattern as classify).
      parts.push(
        promptOverride && promptOverride.trim()
          ? interpolatePrompt(promptOverride, { file_name: fileName })
          : m.content,
      );
    } else if (m.role === 'assistant') {
      parts.push(
        `### YOUR PREVIOUS ANSWER (was INVALID)\n${m.content}`,
      );
    } else {
      // error
      parts.push(
        `### PROBLEM WITH YOUR PREVIOUS ANSWER\n${m.content}\n\n` +
          `Fix ONLY this problem and return the corrected JSON object in the exact ` +
          `shape from OUTPUT REQUIREMENTS above. No markdown, no explanation.`,
      );
    }
  }
  return { _prompt: parts.join('\n\n') };
}

// ─── Extraction prompt ─────────────────────────────────────────────────────────

/**
 * Render an AI-field list as a "- key (type): description" block for the prompt.
 * When the field declares a closed option set, the options are appended after the
 * description so the model sees the exact allowed strings instead of having them
 * paraphrased inside `desc`.
 *
 * Takes a structural { aiFields } shape so the same helper works for both a
 * whole single-call ExtractSchema and one ExtractSchemaGroup inside a multi-
 * call schema.
 */
function buildFieldList(source: { aiFields: FieldSpec[] }): string {
  return source.aiFields
    .map((f) => {
      const options = f.enum?.length
        ? `\n  Expected values (match one EXACTLY when it fits; otherwise return what the document says): ${f.enum
            .map((o) => JSON.stringify(o))
            .join(' | ')}`
        : '';
      return `- ${f.key} (${fieldTypeOf(f)}): ${f.desc}${options}`;
    })
    .join('\n');
}

/**
 * The JSON placeholder for one field, matching its declared type.
 *
 * The placeholder must agree with the field's type: telling the model to return
 * a string for a field whose description asks for an array is a contradiction it
 * has to resolve on its own. Only string-ish LEAVES carry the ⟨conf:…⟩ marker —
 * booleans and numbers never do, and containers carry it on their leaves (a
 * marker after a closing ] or } would not be valid JSON).
 */
function skeletonPlaceholder(f: FieldSpec): string {
  const scalar = '"<value> ⟨conf:0.0-1.0⟩"';
  switch (fieldTypeOf(f)) {
    case 'boolean':
      return 'true | false | null';
    case 'number':
      return '<number> | null';
    case 'date':
      return '"<DD/MM/YYYY> ⟨conf:0.0-1.0⟩" | null';
    case 'string[]':
      // Empty array when nothing is ticked — never null (null would hide the
      // field entirely, making it impossible to distinguish "not ticked" from
      // "not asked").
      return `[${scalar}, ...] | []`;
    case 'object':
      // Always return the object with its sub-keys present; set each sub-key
      // that is not on the document to null individually — never collapse the
      // whole object to null (that would hide every sub-field at once).
      return `{ "<sub_key>": ${scalar} | null, ... }`;
    case 'object[]':
      return `[ { "<sub_key>": ${scalar}, ... }, ... ] | []`;
    case 'string':
    default:
      return `${scalar} | null`;
  }
}

/**
 * Render the exact JSON skeleton the AI should return: one key per AI field,
 * each showing the shape expected for that field's declared type. Fixed fields
 * are NOT included here — the code adds those after extraction, so the AI never
 * sees or overwrites them.
 *
 * Takes a structural { aiFields } shape so the same helper works for both a
 * whole single-call ExtractSchema and one ExtractSchemaGroup inside a multi-
 * call schema.
 */
function buildJsonSkeleton(source: { aiFields: FieldSpec[] }): string {
  const lines = source.aiFields.map((f) => `  "${f.key}": ${skeletonPlaceholder(f)}`);
  return `{\n${lines.join(',\n')}\n}`;
}

/**
 * `messages` thread entry for the extract retry loop. Same shape as
 * SplitMessage — a message has a role and a content string. We export a type
 * alias rather than a new interface so the split classifier's helpers and the
 * extract retry loop share exactly one message shape.
 *
 *   - system:    the base task prompt (built once, first entry).
 *   - assistant: the LLM's raw JSON reply from a previous attempt.
 *   - error:     the parse/validation problem the code caught — appended so
 *                the next attempt sees exactly what was wrong and self-corrects.
 */
export type ExtractRetryMessage = SplitMessage;

/**
 * Build the STATIC "system" prompt for extracting every field of a single-call
 * ExtractSchema in one LLM call. Returns just the string content of the system
 * message; wrap it in `{ role: 'system', content }` at the call site (see
 * extract-engine.ts::runExtractCallWithRetry) and feed it into renderExtractPrompt.
 *
 * Structural `{ aiFields }` parameter — accepts either a whole ExtractSchema or
 * an ExtractSchemaGroup, though the group-scoped framing lives in the sibling
 * builder below.
 */
export function buildExtractSystemPrompt(
  code: string,
  fileName: string,
  source: { aiFields: FieldSpec[] },
): string {
  return `${PAM_SYSTEM_PROMPT_HEADER}

### TASK
Extract the fields below from the document "${fileName}" (type: ${code}).
Read each field's description and put the REAL value found on the document.

### FIELDS TO EXTRACT
${buildFieldList(source)}
${PAM_OUTPUT_FORMAT_HINT}

### CONFIDENCE MARKER
- For every STRING value you CAN read, append your confidence at the very END of it:
  "<the value> ⟨conf:0.NN⟩"  where 0.NN is between 0.00 and 1.00 (how sure you are it is correct).
  Example: "ho_ten": "Nguyễn Văn A ⟨conf:0.95⟩"
- If a scalar STRING field is NOT on the document, return null (no marker).
- boolean and number fields carry NO marker — return the raw true/false/number.
- For array and object fields, put the marker on each STRING value INSIDE them —
  NEVER after the closing ] or }, which would not be valid JSON:
  "muc_dich": ["Quản lý dòng tiền ⟨conf:0.95⟩", "Nhận lương ⟨conf:0.90⟩"]
- Put the ⟨conf:...⟩ marker ONLY at the end of a value, nowhere else inside it.
- string[] field with nothing ticked / found: return [] (empty array), NOT null.
- object field: ALWAYS return the object — set each sub-key that is missing to null
  individually. NEVER collapse the whole object to null.

### OUTPUT SHAPE
Return ONE JSON object with EXACTLY these keys (fill each with the value + confidence
marker you read, or null if it is not on the document):
${buildJsonSkeleton(source)}`;
}

/**
 * Build the STATIC "system" prompt for extracting ONE GROUP of a
 * MultiCallExtractSchema. Same shape as buildExtractSystemPrompt with three
 * additions that keep the model on task for a single slice of the form:
 *
 *   1. A "PART N of M" header, so the model knows this is not the whole form.
 *   2. An "extract ONLY the fields listed below" instruction.
 *   3. The group's optional contextHint (e.g. 'Focus ONLY on Section "I…"').
 *
 * Returns just the string content of the system message — the retry loop wraps
 * it into `{ role: 'system', content }` and feeds it into renderExtractPrompt.
 */
export function buildExtractSystemPromptForGroup(
  code: string,
  fileName: string,
  group: ExtractSchemaGroup,
  groupIndex: number,
  groupCount: number,
): string {
  const contextLine = group.contextHint
    ? `\n${group.contextHint.trim()}\n`
    : '';

  return `${PAM_SYSTEM_PROMPT_HEADER}

### TASK — PART ${groupIndex + 1} OF ${groupCount}
Extract the fields below from the document "${fileName}" (type: ${code}).
This is ONE part of a larger form; extract ONLY the fields listed below — do NOT
attempt to read any other section of the form.${contextLine}

### FIELDS TO EXTRACT
${buildFieldList(group)}
${PAM_OUTPUT_FORMAT_HINT}

### CONFIDENCE MARKER
- For every STRING value you CAN read, append your confidence at the very END of it:
  "<the value> ⟨conf:0.NN⟩"  where 0.NN is between 0.00 and 1.00 (how sure you are it is correct).
  Example: "ho_ten": "Nguyễn Văn A ⟨conf:0.95⟩"
- If a scalar STRING field is NOT on the document, return null (no marker).
- boolean and number fields carry NO marker — return the raw true/false/number.
- For array and object fields, put the marker on each STRING value INSIDE them —
  NEVER after the closing ] or }, which would not be valid JSON:
  "muc_dich": ["Quản lý dòng tiền ⟨conf:0.95⟩", "Nhận lương ⟨conf:0.90⟩"]
- Put the ⟨conf:...⟩ marker ONLY at the end of a value, nowhere else inside it.
- string[] field with nothing ticked / found: return [] (empty array), NOT null.
- object field: ALWAYS return the object — set each sub-key that is missing to null
  individually. NEVER collapse the whole object to null.

### OUTPUT SHAPE
Return ONE JSON object with EXACTLY these keys and no others (fill each with the
value + confidence marker you read, or null if it is not on the document):
${buildJsonSkeleton(group)}`;
}

/**
 * Render the accumulated `messages` thread into a SINGLE prompt string (the one
 * dynamic parameter passed to the connector as `_prompt`). On the first attempt
 * this is just the system prompt; on retries it also shows the previous answer
 * and the parse/validation error, then re-asks for a corrected JSON object.
 *
 * Twin of renderSplitPrompt — both share the same LangGraph-style retry framing
 * so the LLM sees a consistent "PROBLEM WITH YOUR PREVIOUS ANSWER … Fix ONLY this
 * problem" instruction whether it is being asked to split-classify or extract.
 *
 * @param messages       the thread (system first, then optional assistant/error pairs)
 * @param fileName       used only when a Profile prompt override is present
 * @param promptOverride optional Profile override for the SYSTEM prompt; the
 *                       retry framing (previous answer + error) is still appended
 *                       so retries keep working even with a custom base prompt.
 */
export function renderExtractPrompt(
  messages: ExtractRetryMessage[],
  fileName: string,
  promptOverride?: string,
): { _prompt: string } {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      parts.push(
        promptOverride && promptOverride.trim()
          ? interpolatePrompt(promptOverride, { file_name: fileName })
          : m.content,
      );
    } else if (m.role === 'assistant') {
      parts.push(`### YOUR PREVIOUS ANSWER (was INVALID)\n${m.content}`);
    } else {
      // error
      parts.push(
        `### PROBLEM WITH YOUR PREVIOUS ANSWER\n${m.content}\n\n` +
          `Fix ONLY this problem and return the corrected JSON object in the exact ` +
          `shape from OUTPUT SHAPE above. No markdown, no explanation.`,
      );
    }
  }
  return { _prompt: parts.join('\n\n') };
}
