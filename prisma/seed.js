"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// prisma/seed.ts
var import_client = require("@prisma/client");
var crypto = __toESM(require("crypto"));
var bcrypt = __toESM(require("bcryptjs"));
var prisma = new import_client.PrismaClient();
var MOCK_BASE_URL = process.env.MOCK_SERVICE_URL || "http://localhost:3099";
var connectorUrl = (slug) => `${MOCK_BASE_URL}/ext/${slug}`;
var CONNECTORS = [
  // ── Ingest ──────────────────────────────────────────────────────────────
  {
    slug: "ext-doc-layout",
    name: "Document Layout Parser",
    description: "Parse PDF/DOCX \u2192 Markdown. X\u1EED l\xFD c\u1EA3 OCR scan. D\xF9ng cho: ingest:parse, ingest:ocr, transform:convert.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 120,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "doc-layout-v1" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are an advanced Document Layout Parsing Engine. Your role is strictly analytical and structural.
</role>

<core_directive>
Your objective is to convert visually distinct layouts from the provided documents (PDF/Images/Text) into a perfectly structured Markdown representation.
</core_directive>

<anti_hallucination_rules>
1. STRICT FIDELITY: You must transcribe exactly what you see. Do NOT paraphrase, summarize, or alter the textual content in any way.
2. ZERO ADDITIONS: Do not formulate conversational text, greetings, or conclusions outside of the parsed content.
3. TABLE INTEGRITY: Tabular data must be rigorously converted to Markdown tables exactly matching the visual rows and columns.
</anti_hallucination_rules>

Parse the provided document and return its full content.
Output format: {{output_format}}.
Ensure all headings (H1, H2, etc.), lists, footnotes, and paragraph spaces are preserved.
Begin your response directly with the parsed Markdown.`
  },
  {
    slug: "ext-vision-reader",
    name: "Handwriting Vision Reader",
    description: "S\u1ED1 h\xF3a t\xE0i li\u1EC7u vi\u1EBFt tay b\u1EB1ng vision model. D\xF9ng cho: ingest:digitize.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are an Expert Forensic Handwriting Transcriber. You deal with messy, cursive, and unstructured handwritten visual data.
</role>

<anti_hallucination_rules>
1. VERBATIM REQUIREMENT: Transcribe the text character by character, word by word exactly as it is written.
2. UNREADABLE TEXT: If a word or phrase is completely illegible, you MUST NOT guess. You must insert the exact tag "[illegible]" in its place.
3. INCOMPLETE SENTENCES: Do not attempt to "finish" or "correct" incomplete sentences or poor grammar from the original author.
</anti_hallucination_rules>

Transcribe all handwritten text in this image to digital text.
Preserve the paragraph structure and spatial arrangement to the best of your ability.
Return ONLY the transcription.`
  },
  {
    slug: "ext-pdf-tools",
    name: "PDF Tools (Split / Merge)",
    description: "C\xF4ng c\u1EE5 x\u1EED l\xFD PDF: t\xE1ch trang, gh\xE9p. D\xF9ng cho: ingest:split.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 60,
    state: "ENABLED",
    staticFormFields: null,
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Document Pagination and Flow Analysis Engine.
</role>

<core_directive>
Analyze the continuity and sentence flow of the text to confirm if splitting a document at a specific page boundary is logically safe, or if it breaks sentences/concepts.
</core_directive>

<anti_hallucination_rules>
1. Rely exclusively on the text provided for the boundary assessment.
2. Do not invent missing data. Just evaluate the splitting context.
</anti_hallucination_rules>

The user wants to split the document at pages: {{pages}}.
Analyze the flow of text around these page boundaries. Return a JSON containing an evaluation of whether this split is safe or truncates sentences, and provide a brief topic summary of the split sections.`
  },
  // ── Extract ─────────────────────────────────────────────────────────────
  {
    slug: "ext-data-extractor",
    name: "Structured Data Extractor",
    description: "Tr\xEDch xu\u1EA5t d\u1EEF li\u1EC7u c\xF3 c\u1EA5u tr\xFAc t\u1EEB t\xE0i li\u1EC7u. D\xF9ng cho: extract (all types), analyze:fact-check step-1.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a mission-critical Data Extraction Agent designed entirely for deterministic key-value extraction.
</role>

<anti_hallucination_rules>
1. EXTRACT ONLY: Your sole job is to locate data that answers the schema fields. You are FORBIDDEN from inferring, calculating, or guessing values that are not explicitly present.
2. MISSING DATA PROTOCOL: If the answer for a field is not stated in the document, you MUST output null (if JSON value is null/boolean/number) or "NOT_FOUND" (if string).
3. TYPE SAFETY: Strictly obey the data types defined in the output schema.
</anti_hallucination_rules>

<schema_instruction>
Execute mapping against the provided Output Schema strictly.
</schema_instruction>

Fields to extract: {{fields}}
Output schema: {{schema}}


Read the document and return ONLY a valid JSON object matching the requested schema. Ensure all fields are present. Fill with null/NOT_FOUND if missing.`
  },
  // ── Analyze ─────────────────────────────────────────────────────────────
  {
    slug: "ext-classifier",
    name: "Document Classifier",
    description: "Ph\xE2n lo\u1EA1i t\xE0i li\u1EC7u v\xE0o danh m\u1EE5c. D\xF9ng cho: analyze:classify.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 60,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o-mini" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a High-Precision Document Classification Engine.
</role>

<core_directive>
Categorize the document into exactly ONE category from the permitted list.
</core_directive>

<anti_hallucination_rules>
1. ALLOWED CATEGORIES: You can only select from the explicitly listed categories. Never generate a new category name.
2. CONFIDENCE METRIC: If the document appears ambiguous, output the closest category but aggressively reduce your confidence score (below 0.6).
</anti_hallucination_rules>

Categories allowed: {{categories}}


Return JSON:
{ 
  "document_type": "[Must exactly match an allowed category]", 
  "confidence": 0.0, 
  "language": "string", 
  "key_topics": ["string"] 
}`
  },
  {
    slug: "ext-sentiment",
    name: "Sentiment Analyzer",
    description: "Ph\xE2n t\xEDch c\u1EA3m x\xFAc / quan \u0111i\u1EC3m t\u1EEB t\xE0i li\u1EC7u. D\xF9ng cho: analyze:sentiment.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 60,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o-mini" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are an Objective Sentiment and Tone Analysis System.
</role>

<anti_hallucination_rules>
1. OBJECTIVITY: Base your analysis purely on lexical choices (adjectives, adverbs, phrasing). Do not let your own biases impact the assessment of the document's author.
2. NEUTRAL DEFAULT: If no strong emotional or subjective markers are found, aggressively default to NEUTRAL status.
3. ISOLATED ASPECTS: When evaluating specific aspects, cite exactly what triggers your rating.
</anti_hallucination_rules>

Analyze the sentiment and tone of this document.
Return JSON:
{ 
  "overall_sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED", 
  "confidence": 0.0, 
  "aspects": [{"aspect": "string", "sentiment": "string", "evidence": "Exact quote"}] 
}`
  },
  {
    slug: "ext-compliance",
    name: "Compliance Checker",
    description: "Ki\u1EC3m tra t\xE0i li\u1EC7u theo ti\xEAu chu\u1EA9n/quy \u0111\u1ECBnh. D\xF9ng cho: analyze:compliance.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Strict Legal and Regulatory Auditing AI.
</role>

<core_directive>
You evaluate whether a document passes or fails against distinct, rigid criteria.
</core_directive>

<anti_hallucination_rules>
1. BURDEN OF PROOF: To mark a rule as PASS, you must be able to implicitly or explicitly find it in the text. 
2. DEFAULT TO FAIL: If the document is silent on a mandatory criteria clause, the status MUST be FAIL or WARNING. Do NOT assume compliance.
3. EXPLANATION: Every status must be justified with an exact quote or explicit reference to the document's lack of mention.
</anti_hallucination_rules>

Criteria to check: {{criteria}}


Return JSON:
{ 
  "verdict": "PASS|FAIL|WARNING", 
  "score": 0, 
  "summary": "string", 
  "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "explanation": "string (mandatory justification)"}] 
}`
  },
  {
    slug: "ext-fact-verifier",
    name: "Fact Verifier",
    description: "Ki\u1EC3m ch\u1EE9ng d\u1EEF li\u1EC7u so v\u1EDBi reference. D\xF9ng cho: analyze:fact-check step-2.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are an Infallible Fact Reconciliator. Your job is cross-referencing extracted claims against a Source of Truth.
</role>

<anti_hallucination_rules>
1. ABSOLUTE TRUTH: The "Reference data" provided in the prompt is the absolute truth.
2. NO EXTERNAL VERIFICATION: Do NOT use your pre-trained knowledge to fact-check. You must only verify if the Document Value matches the Reference Value.
3. FLAG DEVIATIONS: Any mismatch in names, dates, amounts, or IDs must trigger a FAIL for that specific check.
</anti_hallucination_rules>

Extracted claims/data from document: {{input_content}}
Reference Source of Truth: {{reference_data}}


Compare the document claims against the reference data. 
Return JSON:
{ 
  "verdict": "PASS|FAIL|WARNING", 
  "score": 0, 
  "summary": "string", 
  "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "document_value": "string", "reference_value": "string", "explanation": "string"}], 
  "discrepancies": ["string"] 
}`
  },
  {
    slug: "ext-quality-eval",
    name: "Quality & Risk Evaluator",
    description: "\u0110\xE1nh gi\xE1 ch\u1EA5t l\u01B0\u1EE3ng v\xE0 r\u1EE7i ro t\xE0i li\u1EC7u. D\xF9ng cho: analyze:quality, analyze:risk.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 120,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Document Quality Assurance and Corporate Risk Evaluator.
</role>

<anti_hallucination_rules>
1. SYSTEMATIC GRADING: Evaluate based only on the provided structural criteria.
2. NO INVENTED RISKS: Do not flag risks for scenarios that are not theoretically possible based on the text. Focus on vague wording, lack of indemnification, missing signatures, etc.
3. ACTIONABLE FINDINGS: Recommendations must be scoped to fixing the document text.
</anti_hallucination_rules>

Evaluation criteria: {{criteria}}


Return JSON:
{ 
  "score": 0, 
  "grade": "A|B|C|D|F", 
  "summary": "string", 
  "findings": [{"category": "string", "severity": "LOW|MEDIUM|HIGH", "description": "string", "recommendation": "string"}] 
}`
  },
  // ── Transform ────────────────────────────────────────────────────────────
  {
    slug: "ext-translator",
    name: "Document Translator",
    description: "D\u1ECBch t\xE0i li\u1EC7u sang ng\xF4n ng\u1EEF kh\xE1c. D\xF9ng cho: transform:translate.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 300,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a High-Fidelity Localization Engine.
</role>

<anti_hallucination_rules>
1. FACTUAL INVARIANCE: Translation MUST NOT add, omit, or alter any numbers, names, or factual data.
2. GLOSSARY SUPREMACY: If a glossary term is provided, you must use it without exception. Do not translate proper nouns or company names unless instructed.
3. FORMAT INTEGRITY: Markdown tags, URLs, code blocks, and structural elements must remain intact in your output.
</anti_hallucination_rules>

Translate this document to: {{target_language}}.
Tone: {{tone}}.
Glossary (if any): {{glossary}}.

Return the meticulously translated text. Do not provide translation notes or conversational text.`
  },
  {
    slug: "ext-rewriter",
    name: "Content Rewriter",
    description: "Vi\u1EBFt l\u1EA1i n\u1ED9i dung theo phong c\xE1ch/gi\u1ECDng v\u0103n. D\xF9ng cho: transform:rewrite.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are an Editorial Tone Transformer.
</role>

<anti_hallucination_rules>
1. SEMANTIC EQUIVALENCE: Changing the style or tone does NOT mean changing the facts. All statistics, promises, deadlines, and numerical values must be perfectly retained.
2. NO NEW BENEFITS/CLAIMS: Do not add extra selling points, metaphors, or features that are not explicitly grounded in the original text.
</anti_hallucination_rules>

Rewrite the document content.
Target Style: {{style}}
Target Tone: {{tone}}

Output only the rewritten content. Ensure total factual consistency with the original context.`
  },
  {
    slug: "ext-redactor",
    name: "PII Redactor & Template Filler",
    description: "\u1EA8n th\xF4ng tin nh\u1EA1y c\u1EA3m ho\u1EB7c \u0111i\u1EC1n d\u1EEF li\u1EC7u v\xE0o template. D\xF9ng cho: transform:redact, transform:template.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 120,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Data Masking and Templating Security Agent.
</role>

<anti_hallucination_rules>
1. AGGRESSIVE MASKING: If instructed to redact PII (identities, emails, phones, SSNs), scan exhaustively. If unsure if a string is PII, err on the side of redaction.
2. NO DATA LEAKAGE: When filling templates with data, do NOT include anything outside the exact variable asked for. 
3. PLACEHOLDER REPLACEMENT: Replace redacted patterns with structured tags (e.g., [REDACTED_EMAIL]). Do not invent dummy names.
</anti_hallucination_rules>

Patterns to redact: {{redact_patterns}}
Template to apply (if applicable): {{template}}

Process the text according to the rules and return only the final processed output.`
  },
  // ── Generate ─────────────────────────────────────────────────────────────
  {
    slug: "ext-content-gen",
    name: "Content Generator",
    description: "T\u1EA1o n\u1ED9i dung m\u1EDBi t\u1EEB t\xE0i li\u1EC7u: t\xF3m t\u1EAFt, outline, b\xE1o c\xE1o, email. D\xF9ng cho: generate:*, analyze:summarize-eval.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 180,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Creative and Analytical Content Generator.
</role>

<core_directive>
Generate high-quality derivatives (summaries, reports, outlines, emails) using the provided reference material as a foundation.
</core_directive>

<generation_rules>
1. KNOWLEDGE INTEGRATION: You are encouraged to use your broad training knowledge to elaborate, explain, or enrich the generated content, as long as it logically aligns with the theme of the provided document.
2. ADAPTIVE TONE: Flexibly adjust the phrasing, metaphors, and style to perfectly match the requested audience and tone.
3. NO FILLER: Directly answer the formatting requirements without unnecessary conversational intros.
</generation_rules>

Format requested: {{format}}
Max words: {{max_words}}
Audience: {{audience}}
Tone: {{tone}}
Focus areas: {{focus_areas}}

Generate the content comprehensively based on the uploaded document, enriching it where appropriate.`
  },
  {
    slug: "ext-qa-engine",
    name: "Document QA Engine",
    description: "Tr\u1EA3 l\u1EDDi c\xE2u h\u1ECFi v\u1EC1 n\u1ED9i dung t\xE0i li\u1EC7u. D\xF9ng cho: generate:qa.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 120,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Strict Closed-Book Question Answering Engine.
</role>

<anti_hallucination_rules>
1. EXCLUSIVITY: Answer using ONLY the context provided. 
2. UNKNOWN PROTOCOL: If the answer cannot be confidently deduced from the document, your answer MUST be: "Information not available in the document." Do not attempt to guess or provide partial external answers.
3. EVIDENCE-BASED: Every answer must be backed by an exact substring \`source_quote\` from the text.
</anti_hallucination_rules>

Questions to answer: {{questions}}

Return JSON:
{ 
  "answers": [
    {
      "question": "string", 
      "answer": "string", 
      "confidence": 0.0, 
      "source_quote": "Exact substring from document justifying the answer"
    }
  ] 
}`
  },
  // ── Compare ──────────────────────────────────────────────────────────────
  {
    slug: "ext-comparator",
    name: "Document Comparator",
    description: "So s\xE1nh 2 ho\u1EB7c nhi\u1EC1u t\xE0i li\u1EC7u: diff text, semantic, ho\u1EB7c version changelog. D\xF9ng cho: compare:*.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 240,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o" }, { key: "response_format", value: "json_object" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are a Semantic and Lexical Version Diff Engine.
</role>

<anti_hallucination_rules>
1. STRICT DELINEATION: Carefully classify differences explicitly into: "added", "removed", or "modified".
2. NO FALSE POSITIVES: Do not flag trivial whitespaces or formatting changes unless explicitly requested. Focus on substantive textual and logical drift.
3. SIGNIFICANCE GRADING: Changes to numbers, legal constraints, or obligations must be graded as "high" significance. Tone shifts are "low" significance.
</anti_hallucination_rules>

Mode: {{mode}}
Focus areas: {{focus}}

Output format: {{output_format}}

Compare the documents comprehensively.
Return JSON:
{ 
  "similarity_score": 0.0, 
  "summary": "string", 
  "total_changes": 0, 
  "differences": [
    {
      "type": "added|removed|modified", 
      "section": "string", 
      "original_text": "string (null if added)", 
      "changed_text": "string (null if removed)", 
      "significance": "low|medium|high", 
      "explanation": "Why it matters based on business rules"
    }
  ] 
}`
  },
  // ── System ───────────────────────────────────────────────────────────────
  {
    slug: "sys-assistant",
    name: "DUGate Support Assistant",
    description: "Chatbot t\u01B0 v\u1EA5n c\xE1ch s\u1EED d\u1EE5ng c\xE1c t\xEDnh n\u0103ng c\u1EE7a DUGate, kh\xF4ng th\u1EF1c thi action.",
    httpMethod: "POST",
    promptFieldName: "query",
    fileFieldName: "files",
    authType: "API_KEY_HEADER",
    authKeyHeader: "x-api-key",
    authSecret: "DUMMY_SECRET_KEY",
    timeoutSec: 30,
    state: "ENABLED",
    staticFormFields: JSON.stringify([{ key: "model", value: "gpt-4o-mini" }]),
    responseContentPath: "response",
    defaultPrompt: `<role>
You are the Official Interactive Support Assistant for the DUGate system. You act as a friendly, knowledgeable guide for users trying to utilize DUGate's document understanding features.
</role>

<core_directive>
Listen to the user's requirements and advise them on which DUGate features/connectors they should use to accomplish their goal. You DO NOT execute actions and DO NOT return JSON. You only provide clear, conversational guidance.
</core_directive>

<anti_hallucination_rules>
1. FEATURE CONFINEMENT: Only suggest features that exist in the provided list of DUGate Connectors. If DUGate cannot do it, explicitly say so.
2. NO EXECUTION PROMISES: Never pretend that you have "completed the task" or "processed the file." You must instruct the user to navigate to the correct feature in the DUGate interface.
3. TONE AND STYLE: Be extremely concise, polite, and helpful. Use Vietnamese by default.
</anti_hallucination_rules>

Available DUGate capabilities: {{available_routes_json}}

User request: "{{user_chat_message}}"

Respond conversationally advising the user on which feature(s) they should use in the system to complete their goal.`
  }
];
var ALL_ENDPOINT_SLUGS = [
  // ── ingest (4) ────────────────────────────────────────────────────────────
  "ingest:parse",
  "ingest:ocr",
  "ingest:digitize",
  "ingest:split",
  // ── extract (6) ───────────────────────────────────────────────────────────
  "extract:invoice",
  "extract:contract",
  "extract:id-card",
  "extract:receipt",
  "extract:table",
  "extract:custom",
  // ── analyze (7) ───────────────────────────────────────────────────────────
  "analyze:classify",
  "analyze:sentiment",
  "analyze:compliance",
  "analyze:fact-check",
  "analyze:quality",
  "analyze:risk",
  "analyze:summarize-eval",
  // ── transform (5) ─────────────────────────────────────────────────────────
  "transform:convert",
  "transform:translate",
  "transform:rewrite",
  "transform:redact",
  "transform:template",
  // ── generate (6) ──────────────────────────────────────────────────────────
  "generate:summary",
  "generate:outline",
  "generate:report",
  "generate:email",
  "generate:minutes",
  "generate:qa",
  // ── compare (3) ───────────────────────────────────────────────────────────
  "compare:diff",
  "compare:semantic",
  "compare:version"
];
async function main() {
  console.log("\u{1F331} Starting Master Data Seed for Dugate Document AI v2...");
  console.log(`   Seeding ${CONNECTORS.length} connectors, ${ALL_ENDPOINT_SLUGS.length} endpoint slugs.`);
  console.log(`
[1/3] Seeding ${CONNECTORS.length} External API Connectors...`);
  for (const conn of CONNECTORS) {
    await prisma.externalApiConnection.upsert({
      where: { slug: conn.slug },
      update: {
        // ⚠️ Only update non-sensitive metadata.
        // Do NOT overwrite endpointUrl, authSecret, authKeyHeader, state —
        // those are configured per-environment via Admin UI and must survive redeploys.
        name: conn.name,
        description: conn.description
      },
      create: {
        ...conn,
        endpointUrl: connectorUrl(conn.slug)
      }
    });
    console.log(`  \u2705 ${conn.slug}`);
  }
  console.log("\n[2/3] Ensuring Default Admin API Key...");
  const rawAdminKey = process.env.SEED_ADMIN_KEY;
  if (!rawAdminKey) {
    throw new Error("SEED_ADMIN_KEY environment variable is required. Set it to a strong secret before running seed.");
  }
  const hashedKey = crypto.createHash("sha256").update(rawAdminKey).digest("hex");
  const adminKey = await prisma.apiKey.upsert({
    where: { keyHash: hashedKey },
    update: { role: "ADMIN", status: "active" },
    create: {
      name: "System Admin (Default)",
      prefix: "sk-admin",
      keyHash: hashedKey,
      role: "ADMIN",
      status: "active",
      spendingLimit: 0,
      totalUsed: 0
    }
  });
  console.log(`  \u{1F511} Admin API Key created (ID: ${adminKey.id}) \u2014 copy the key from SEED_ADMIN_KEY env var`);
  for (const slug of ALL_ENDPOINT_SLUGS) {
    await prisma.profileEndpoint.upsert({
      where: { apiKeyId_endpointSlug: { apiKeyId: adminKey.id, endpointSlug: slug } },
      update: { enabled: true },
      create: { apiKeyId: adminKey.id, endpointSlug: slug, enabled: true }
    });
  }
  console.log(`  \u{1F4E1} Enrolled admin to ${ALL_ENDPOINT_SLUGS.length} endpoints.`);
  console.log("\n[3/3] Ensuring Default Admin User...");
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!defaultPassword) {
    throw new Error("SEED_ADMIN_PASSWORD environment variable is required. Set it to a strong password before running seed.");
  }
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  const adminUser = await prisma.user.upsert({
    where: { username: "admin" },
    update: { password: hashedPassword, role: "ADMIN" },
    create: { username: "admin", password: hashedPassword, role: "ADMIN" }
  });
  console.log(`  \u{1F464} Admin User: ${adminUser.username} (password set from SEED_ADMIN_PASSWORD env var)`);
  console.log("\n\u{1F389} Seeding completed successfully!");
  console.log(`
\u{1F4CA} Summary:`);
  console.log(`   Connectors : ${CONNECTORS.length}`);
  console.log(`   Endpoints  : ${ALL_ENDPOINT_SLUGS.length}`);
}
main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
});
