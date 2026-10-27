// lib/pipelines/workflows/prompts/structure-compare-prompts.ts
// Prompt builders for the Structure-Mapped Comparison workflow.
//
// Each function returns { _prompt: "complete prompt text" }.
// The _prompt variable bypasses the DB connector template entirely.
// Connector still provides: API URL, auth, model, timeout, response parsing.
//
// All prompt builders accept an optional `promptOverride` string.
// When provided, it replaces the code-generated prompt, with {{variable}} interpolation.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StructureExtractionInput {
  documentId: string;
  documentName: string;
  documentText: string;
  /** Hint about the document format (pdf, docx, txt, markdown) */
  formatHint?: string;
  /** Whether the document was OCR'd (may affect confidence) */
  isOcr?: boolean;
}

export interface StructureExtractionResult {
  documentId: string;
  documentName: string;
  sections: ParsedSection[];
  confidence: number;
  source: 'native_toc' | 'inferred' | 'ai_extracted';
}

export interface ParsedSection {
  id: string;
  identifier: string;
  title: string;
  level: number;
  startPos: number;
  endPos: number;
  content: string;
  children?: ParsedSection[];
  ocrConfidence?: number;
}

// ─── Step 2: Structure Extraction ─────────────────────────────────────────────

/**
 * Build prompt for AI-based structure extraction from a document.
 * Instructs the AI to analyze the document text, identify its hierarchical
 * structure, and return a DocumentOutline-compatible JSON.
 *
 * Handles:
 * - Vietnamese legal documents (Điều, Khoản, Mục, Điểm patterns)
 * - Standard documents with numbered sections and markdown headings
 * - Documents with native TOC vs inferred structure
 */
export function buildStructureExtractionPrompt(
  input: StructureExtractionInput,
  promptOverride?: string,
): Record<string, unknown> {
  const { documentId, documentName, documentText, formatHint, isOcr } = input;

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        document_id: documentId,
        document_name: documentName,
        document_text: documentText,
        format_hint: formatHint || 'unknown',
        is_ocr: String(isOcr ?? false),
      }),
    };
  }

  const ocrNote = isOcr
    ? `\nNOTE: This document was processed via OCR. Some text may contain recognition errors. Factor this into your confidence score.`
    : '';

  const formatNote = formatHint
    ? `\nDOCUMENT FORMAT: ${formatHint}`
    : '';

  return {
    _prompt: `You are an expert document structure analyzer specializing in hierarchical document parsing.

=== TASK ===
Analyze the following document and extract its hierarchical structure (outline/table of contents).
Produce a JSON object matching the DocumentOutline schema described below.

CRITICAL RULE: Only split down to the ARTICLE level (Điều / Section / Article). Do NOT create separate sections for clauses (Khoản), points (Điểm), or sub-items within an article. All content under an article (including its clauses and points) should be included as part of that article's "content" field.

=== DOCUMENT INFO ===
Document ID: "${documentId}"
Document Name: "${documentName}"${formatNote}${ocrNote}

=== EXTRACTION STRATEGY ===

Follow this priority order for determining document structure:

1. NATIVE TOC (highest priority — ALWAYS use if available):
   If the document contains an explicit Table of Contents (Mục lục), use it as the PRIMARY and AUTHORITATIVE structure source.
   The TOC defines which sections exist and their hierarchy. Do NOT add sections that are not in the TOC.
   Validate TOC entries against actual content headings found in the document body.
   Set source = "native_toc" if a TOC is found and used.

2. FORMATTING PATTERNS (fallback when no TOC):
   If no native TOC exists, infer structure from formatting patterns:
   - Font size changes, bold text, underlined text
   - Numbering patterns (I., II., 1., 2., Điều 1, Điều 2)
   - Indentation levels
   - Markdown headings (#, ##, ###)
   Set source = "inferred" when using formatting-based detection.

3. AI INFERENCE (last resort):
   If formatting is ambiguous, use semantic understanding to identify logical sections.
   Set source = "ai_extracted" when relying primarily on semantic analysis.

=== GRANULARITY RULE ===

MAXIMUM DEPTH: Split only to the ARTICLE level. Specifically:

For Vietnamese legal documents:
| Pattern | Level | Include as section? |
|---------|-------|---------------------|
| Phần (Part) | 0 | YES — top-level section |
| Chương (Chapter) | 1 | YES — section |
| Mục (Section within chapter) | 2 | YES — section |
| Điều (Article) | 3 | YES — LEAF section (deepest level) |
| Khoản (Clause) | — | NO — include in Điều's content |
| Điểm (Point) | — | NO — include in Điều's content |

For standard documents:
| Pattern | Level | Include as section? |
|---------|-------|---------------------|
| # Heading 1 / Part / Roman numeral | 1 | YES |
| ## Heading 2 / Chapter / Section | 2 | YES |
| ### Heading 3 / Article / Clause | 3 | YES — LEAF (deepest level) |
| #### and deeper | — | NO — include in parent's content |
| Numbered sub-items (a, b, c, 1., 2.) | — | NO — include in parent's content |

The "content" field of a leaf section (e.g., Điều) must contain ALL text from that article, including all its clauses (Khoản) and points (Điểm).

=== OUTPUT SCHEMA ===

Return ONLY valid JSON (no markdown fences, no explanation) matching this structure:

{
  "documentId": "${documentId}",
  "documentName": "${documentName}",
  "sections": [
    {
      "id": "sec-1",
      "identifier": "Chương I",
      "title": "Quy định chung",
      "level": 1,
      "startPos": 0,
      "endPos": 500,
      "content": "Text content of this chapter header (before first Điều)",
      "children": [
        {
          "id": "sec-1-1",
          "identifier": "Điều 1",
          "title": "Phạm vi điều chỉnh",
          "level": 3,
          "startPos": 50,
          "endPos": 300,
          "content": "Full text of Điều 1 INCLUDING all Khoản and Điểm within it",
          "children": []
        }
      ]
    }
  ],
  "confidence": 85,
  "source": "native_toc"
}

=== FIELD RULES ===

- id: Unique within the document. Use format "sec-{n}" for top-level, "sec-{n}-{m}" for children.
- identifier: The display label as it appears in the document (e.g., "Điều 1", "Chương I", "Section A", "## Overview").
- title: The section heading text. If no explicit title, use the first 15 words of the section content.
- level: Hierarchy depth. 0 = Part, 1 = Chapter, 2 = Mục/Section, 3 = Article/Điều (leaf).
- startPos: Character offset where this section begins in the source text (0-indexed).
- endPos: Character offset where this section ends (exclusive). Must satisfy: startPos <= endPos.
- content: The FULL text content belonging to this section, INCLUDING all sub-items (Khoản, Điểm) within it. For leaf sections (Điều), this is the complete article text.
- children: Nested sub-sections (only for Phần→Chương→Mục→Điều hierarchy). Điều sections should have children: [] (they are leaf nodes).
- confidence: Overall extraction confidence (0-100). Consider:
  - 90-100: Clear structure with explicit TOC
  - 70-89: Structure inferred from consistent formatting
  - 50-69: Ambiguous structure, some guesswork involved
  - Below 50: Very uncertain, document may lack clear structure
- source: How the structure was determined ("native_toc", "inferred", or "ai_extracted")

=== IMPORTANT CONSTRAINTS ===

1. Every character in the document must belong to exactly one section (no gaps, no overlaps).
2. startPos of the first section should be 0 (or the position after any preamble/header).
3. endPos of the last section should equal the document length.
4. Parent section's [startPos, endPos] must encompass all children's ranges.
5. Sections at the same level should be ordered by their startPos (document order).
6. If the document has NO discernible structure, return a single section covering the entire text with confidence < 40.
7. Character positions must be accurate — they will be used to extract section content for comparison.
8. DO NOT split below Article/Điều level. Khoản and Điểm are part of the article content, not separate sections.
9. If a TOC exists, use it as the authoritative list of sections. Do not invent sections not in the TOC.

=== DOCUMENT TEXT ===

${documentText}`,
  };
}

/**
 * Parse the AI response from structure extraction into a typed result.
 * Handles JSON extraction from potentially wrapped responses.
 */
export function parseStructureExtractionResult(
  content: string | null,
  input: StructureExtractionInput,
): StructureExtractionResult {
  const fallback: StructureExtractionResult = {
    documentId: input.documentId,
    documentName: input.documentName,
    sections: [{
      id: 'sec-1',
      identifier: 'Document',
      title: input.documentName,
      level: 1,
      startPos: 0,
      endPos: input.documentText.length,
      content: input.documentText,
    }],
    confidence: 20,
    source: 'ai_extracted',
  };

  if (!content) {
    return fallback;
  }

  try {
    let cleanContent = content.trim();

    // Strip markdown code fences if present
    const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      cleanContent = match[1].trim();
    }

    const parsed = JSON.parse(cleanContent) as StructureExtractionResult;

    // Validate required fields
    if (!parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      console.warn('[parseStructureExtractionResult] No sections in response, using fallback');
      return fallback;
    }

    // Ensure documentId and documentName are set correctly
    parsed.documentId = input.documentId;
    parsed.documentName = input.documentName;

    // Validate confidence range
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 100) {
      parsed.confidence = 50;
    }

    // Validate source field
    if (!['native_toc', 'inferred', 'ai_extracted'].includes(parsed.source)) {
      parsed.source = 'ai_extracted';
    }

    return parsed;
  } catch (err) {
    console.warn(
      `[parseStructureExtractionResult] Failed to parse JSON for ${input.documentName}:`,
      err,
    );
    return fallback;
  }
}

// ─── Step 4: Per-pair Semantic Comparison ─────────────────────────────────────

export interface SectionComparisonInput {
  /** Reference to the MappingEntry that produced this comparison */
  mappingEntryId: string;
  /** Match type of the mapping entry */
  matchType: string;
  /** Section identifier(s) from V1 */
  v1Identifier: string;
  /** Section identifier(s) from V2 */
  v2Identifier: string;
  /** Content from V1 (may be concatenated for MERGED) */
  v1Content: string;
  /** Content from V2 (may be concatenated for SPLIT) */
  v2Content: string;
  /** Change record code prefix (e.g., "CR-001") */
  codePrefix: string;
}

/**
 * Build prompt for per-pair semantic comparison between mapped sections.
 * Instructs the AI comparator to identify semantic differences and produce
 * ChangeRecords with severity levels and verbatim quotes.
 */
export function buildSectionComparisonPrompt(
  input: SectionComparisonInput,
  promptOverride?: string,
): Record<string, unknown> {
  const { mappingEntryId, matchType, v1Identifier, v2Identifier, v1Content, v2Content, codePrefix } = input;

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        mapping_entry_id: mappingEntryId,
        match_type: matchType,
        v1_identifier: v1Identifier,
        v2_identifier: v2Identifier,
        v1_content: v1Content,
        v2_content: v2Content,
        code_prefix: codePrefix,
      }),
    };
  }

  return {
    _prompt: `You are an expert legal document comparator performing semantic comparison between two document sections.

=== TASK ===
Compare the V1 section against the V2 section and identify ALL meaningful semantic differences.
Produce a JSON array of ChangeRecord objects for each difference found.

=== CONTEXT ===
Mapping Entry ID: "${mappingEntryId}"
Match Type: ${matchType}
V1 Section: "${v1Identifier}"
V2 Section: "${v2Identifier}"

=== V1 CONTENT (Original) ===
${v1Content}

=== V2 CONTENT (Modified) ===
${v2Content}

=== COMPARISON RULES ===

1. SEMANTIC FOCUS: Identify changes that alter meaning, legal obligations, rights, conditions, or scope.
   Ignore: whitespace changes, formatting differences, OCR artifacts, trivial punctuation.

2. SEVERITY CLASSIFICATION:
   - CRITICAL: Changes that fundamentally alter legal obligations, liability, or rights
   - MAJOR: Significant changes to conditions, thresholds, deadlines, or scope
   - MODERATE: Notable changes to procedures, definitions, or secondary terms
   - MINOR: Small wording changes that slightly adjust meaning
   - STRUCTURAL: Reorganization without semantic change (renumbering, reordering)

3. VERBATIM QUOTES: For each change, include exact quotes from both V1 and V2.
   Keep quotes concise but sufficient to identify the change (max ~100 words each).

4. If the two sections are semantically identical (no meaningful differences), return an empty array [].

=== OUTPUT SCHEMA ===

Return ONLY valid JSON (no markdown fences, no explanation) — an array of ChangeRecord objects:

[
  {
    "code": "${codePrefix}",
    "severity": "MAJOR",
    "mappingEntryId": "${mappingEntryId}",
    "v1SectionId": "section-id-from-v1",
    "v2SectionId": "section-id-from-v2",
    "description": "Human-readable description of what changed",
    "v1Quote": "Exact quote from V1 showing the original text",
    "v2Quote": "Exact quote from V2 showing the modified text",
    "category": "optional category for grouping"
  }
]

=== FIELD RULES ===

- code: Use "${codePrefix}" for the first change, increment the suffix number for subsequent changes (e.g., ${codePrefix}, CR-002, CR-003...)
- severity: Must be one of: CRITICAL, MAJOR, MODERATE, MINOR, STRUCTURAL
- mappingEntryId: Always "${mappingEntryId}"
- v1SectionId: The V1 section identifier ("${v1Identifier}")
- v2SectionId: The V2 section identifier ("${v2Identifier}")
- description: Clear, concise description in Vietnamese or English (match document language)
- v1Quote: Verbatim text from V1 that was changed/removed (non-empty)
- v2Quote: Verbatim text from V2 that replaced/was added (non-empty)
- category: Optional grouping label (e.g., "liability", "deadline", "scope", "procedure")

=== IMPORTANT ===

- Return [] if no semantic differences exist.
- Do NOT report formatting-only or whitespace-only differences.
- Each distinct semantic change should be a separate ChangeRecord.
- Quotes must be VERBATIM from the provided text (copy-paste, not paraphrased).`,
  };
}

/**
 * Parse the AI response from section comparison into ChangeRecord objects.
 * Handles JSON extraction from potentially wrapped responses.
 */
export function parseSectionComparisonResult(
  content: string | null,
  mappingEntryId: string,
  v1SectionId: string,
  v2SectionId: string,
): ParsedChangeRecord[] {
  if (!content) return [];

  try {
    let cleanContent = content.trim();

    // Strip markdown code fences if present
    const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      cleanContent = match[1].trim();
    }

    const parsed = JSON.parse(cleanContent);

    // Handle both array and object-with-array responses
    const records: unknown[] = Array.isArray(parsed) ? parsed : (parsed.changes || parsed.differences || []);

    // Validate and normalize each record
    return records
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map((r, idx) => ({
        code: typeof r.code === 'string' ? r.code : `CR-${String(idx + 1).padStart(3, '0')}`,
        severity: validateSeverity(r.severity),
        mappingEntryId,
        v1SectionId: typeof r.v1SectionId === 'string' ? r.v1SectionId : v1SectionId,
        v2SectionId: typeof r.v2SectionId === 'string' ? r.v2SectionId : v2SectionId,
        description: typeof r.description === 'string' ? r.description : 'Thay đổi nội dung',
        v1Quote: typeof r.v1Quote === 'string' && r.v1Quote.length > 0 ? r.v1Quote : '(không có trích dẫn)',
        v2Quote: typeof r.v2Quote === 'string' && r.v2Quote.length > 0 ? r.v2Quote : '(không có trích dẫn)',
        category: typeof r.category === 'string' ? r.category : undefined,
      }));
  } catch (err) {
    console.warn(
      `[parseSectionComparisonResult] Failed to parse comparison result for entry ${mappingEntryId}:`,
      err,
    );
    return [];
  }
}

/** Parsed change record from AI comparison response */
export interface ParsedChangeRecord {
  code: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR' | 'STRUCTURAL';
  mappingEntryId: string;
  v1SectionId: string;
  v2SectionId: string;
  description: string;
  v1Quote: string;
  v2Quote: string;
  category?: string;
}

const VALID_SEVERITIES = ['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR', 'STRUCTURAL'] as const;

function validateSeverity(value: unknown): 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR' | 'STRUCTURAL' {
  if (typeof value === 'string' && VALID_SEVERITIES.includes(value.toUpperCase() as any)) {
    return value.toUpperCase() as any;
  }
  return 'MODERATE'; // Default severity if invalid
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Replace {{variable_name}} placeholders in a prompt template.
 * Supports all workflow step variables.
 */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
