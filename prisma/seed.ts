// prisma/seed.ts
// Master Seed Script for Dugate Document AI — v2 Architecture

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

const MOCK_BASE_URL = process.env.MOCK_SERVICE_URL || 'http://localhost:3099';

// Each connector has its own route: /ext/:slug
const connectorUrl = (slug: string) => `${MOCK_BASE_URL}/ext/${slug}`;

// ─── External API Connectors ──────────────────────────────────────────────────
const CONNECTORS = [
  // ── Ingest ──────────────────────────────────────────────────────────────
  {
    slug: 'ext-doc-layout',
    name: 'Document Layout Parser',
    description: 'Parse PDF/DOCX → Markdown. Xử lý cả OCR scan. Dùng cho: ingest:parse, ingest:ocr, transform:convert.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'doc-layout-v1' }]),
    responseContentPath: 'response',
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
Begin your response directly with the parsed Markdown.`,
  },
  {
    slug: 'ext-vision-reader',
    name: 'Handwriting Vision Reader',
    description: 'Số hóa tài liệu viết tay bằng vision model. Dùng cho: ingest:digitize.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'response',
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
Return ONLY the transcription.`,
  },
  {
    slug: 'ext-pdf-tools',
    name: 'PDF Tools (Split / Merge)',
    description: 'Công cụ xử lý PDF: tách trang, ghép. Dùng cho: ingest:split.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: null,
    responseContentPath: 'response',
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
Analyze the flow of text around these page boundaries. Return a JSON containing an evaluation of whether this split is safe or truncates sentences, and provide a brief topic summary of the split sections.`,
  },

  // ── Extract ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-data-extractor',
    name: 'Structured Data Extractor',
    description: 'Trích xuất dữ liệu có cấu trúc từ tài liệu. Dùng cho: extract (all types), analyze:fact-check step-1.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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


Read the document and return ONLY a valid JSON object matching the requested schema. Ensure all fields are present. Fill with null/NOT_FOUND if missing.`,
  },

  // ── Analyze ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-classifier',
    name: 'Document Classifier',
    description: 'Phân loại tài liệu vào danh mục. Dùng cho: analyze:classify.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },
  {
    slug: 'ext-sentiment',
    name: 'Sentiment Analyzer',
    description: 'Phân tích cảm xúc / quan điểm từ tài liệu. Dùng cho: analyze:sentiment.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },
  {
    slug: 'ext-compliance',
    name: 'Compliance Checker',
    description: 'Kiểm tra tài liệu theo tiêu chuẩn/quy định. Dùng cho: analyze:compliance.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },
  {
    slug: 'ext-fact-verifier',
    name: 'Fact Verifier',
    description: 'Kiểm chứng dữ liệu so với reference. Dùng cho: analyze:fact-check step-2.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },
  {
    slug: 'ext-quality-eval',
    name: 'Quality & Risk Evaluator',
    description: 'Đánh giá chất lượng và rủi ro tài liệu. Dùng cho: analyze:quality, analyze:risk.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },

  // ── Transform ────────────────────────────────────────────────────────────
  {
    slug: 'ext-translator',
    name: 'Document Translator',
    description: 'Dịch tài liệu sang ngôn ngữ khác. Dùng cho: transform:translate.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 300,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'response',
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

Return the meticulously translated text. Do not provide translation notes or conversational text.`,
  },
  {
    slug: 'ext-rewriter',
    name: 'Content Rewriter',
    description: 'Viết lại nội dung theo phong cách/giọng văn. Dùng cho: transform:rewrite.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'response',
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

Output only the rewritten content. Ensure total factual consistency with the original context.`,
  },
  {
    slug: 'ext-redactor',
    name: 'PII Redactor & Template Filler',
    description: 'Ẩn thông tin nhạy cảm hoặc điền dữ liệu vào template. Dùng cho: transform:redact, transform:template.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'response',
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

Process the text according to the rules and return only the final processed output.`,
  },

  // ── Generate ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-content-gen',
    name: 'Content Generator',
    description: 'Tạo nội dung mới từ tài liệu: tóm tắt, outline, báo cáo, email. Dùng cho: generate:*, analyze:summarize-eval.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'response',
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

Generate the content comprehensively based on the uploaded document, enriching it where appropriate.`,
  },
  {
    slug: 'ext-qa-engine',
    name: 'Document QA Engine',
    description: 'Trả lời câu hỏi về nội dung tài liệu. Dùng cho: generate:qa.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },

  // ── Compare ──────────────────────────────────────────────────────────────
  {
    slug: 'ext-comparator',
    name: 'Document Comparator',
    description: 'So sánh 2 hoặc nhiều tài liệu: diff text, semantic, hoặc version changelog. Dùng cho: compare:*.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 240,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'response',
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
}`,
  },

  // ── System ───────────────────────────────────────────────────────────────
  {
    slug: 'sys-assistant',
    name: 'DUGate Support Assistant',
    description: 'Chatbot tư vấn cách sử dụng các tính năng của DUGate, không thực thi action.',
    httpMethod: 'POST',
    promptFieldName: 'query',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 30,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }]),
    responseContentPath: 'response',
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

Respond conversationally advising the user on which feature(s) they should use in the system to complete their goal.`,
  },
];

// ─── Endpoint slugs — khớp chính xác với SERVICE_REGISTRY ────────────────────
// Tổng 31 endpoints: ingest(4) + extract(6) + analyze(7) + transform(5) + generate(6) + compare(3)
const ALL_ENDPOINT_SLUGS = [
  // ── ingest (4) ────────────────────────────────────────────────────────────
  'ingest:parse',
  'ingest:ocr',
  'ingest:digitize',
  'ingest:split',
  // ── extract (6) ───────────────────────────────────────────────────────────
  'extract:invoice',
  'extract:contract',
  'extract:id-card',
  'extract:receipt',
  'extract:table',
  'extract:custom',
  // ── analyze (7) ───────────────────────────────────────────────────────────
  'analyze:classify',
  'analyze:sentiment',
  'analyze:compliance',
  'analyze:fact-check',
  'analyze:quality',
  'analyze:risk',
  'analyze:summarize-eval',
  // ── transform (5) ─────────────────────────────────────────────────────────
  'transform:convert',
  'transform:translate',
  'transform:rewrite',
  'transform:redact',
  'transform:template',
  // ── generate (6) ──────────────────────────────────────────────────────────
  'generate:summary',
  'generate:outline',
  'generate:report',
  'generate:email',
  'generate:minutes',
  'generate:qa',
  // ── compare (3) ───────────────────────────────────────────────────────────
  'compare:diff',
  'compare:semantic',
  'compare:version',
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Starting Master Data Seed for Dugate Document AI v2...');
  console.log(`   Seeding ${CONNECTORS.length} connectors, ${ALL_ENDPOINT_SLUGS.length} endpoint slugs.`);

  // 1. Seed External API Connectors
  console.log(`\n[1/3] Seeding ${CONNECTORS.length} External API Connectors...`);
  for (const conn of CONNECTORS) {
    await prisma.externalApiConnection.upsert({
      where: { slug: conn.slug },
      update: {
        // ⚠️ Only update non-sensitive metadata.
        // Do NOT overwrite endpointUrl, authSecret, authKeyHeader, state —
        // those are configured per-environment via Admin UI and must survive redeploys.
        name: conn.name,
        description: conn.description,
      },
      create: {
        ...(conn as any),
        endpointUrl: connectorUrl(conn.slug),
      },
    });
    console.log(`  ✅ ${conn.slug}`);
  }

  // 2. Setup Default Admin API Key & ProfileEndpoints
  console.log('\n[2/3] Ensuring Default Admin API Key...');
  const rawAdminKey = process.env.SEED_ADMIN_KEY;
  if (!rawAdminKey) {
    throw new Error('SEED_ADMIN_KEY environment variable is required. Set it to a strong secret before running seed.');
  }
  const hashedKey = crypto.createHash('sha256').update(rawAdminKey).digest('hex');

  const adminKey = await prisma.apiKey.upsert({
    where: { keyHash: hashedKey },
    update: { role: 'ADMIN', status: 'active' },
    create: {
      name: 'System Admin (Default)',
      prefix: 'sk-admin',
      keyHash: hashedKey,
      role: 'ADMIN',
      status: 'active',
      spendingLimit: 0,
      totalUsed: 0,
    },
  });
  console.log(`  🔑 Admin API Key created (ID: ${adminKey.id}) — copy the key from SEED_ADMIN_KEY env var`);

  // Enroll admin key to all 31 endpoints
  for (const slug of ALL_ENDPOINT_SLUGS) {
    await prisma.profileEndpoint.upsert({
      where: { apiKeyId_endpointSlug: { apiKeyId: adminKey.id, endpointSlug: slug } },
      update: { enabled: true },
      create: { apiKeyId: adminKey.id, endpointSlug: slug, enabled: true },
    });
  }
  console.log(`  📡 Enrolled admin to ${ALL_ENDPOINT_SLUGS.length} endpoints.`);

  // 3. Setup Default Admin User
  console.log('\n[3/3] Ensuring Default Admin User...');
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!defaultPassword) {
    throw new Error('SEED_ADMIN_PASSWORD environment variable is required. Set it to a strong password before running seed.');
  }
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { password: hashedPassword, role: 'ADMIN' },
    create: { username: 'admin', password: hashedPassword, role: 'ADMIN' },
  });
  console.log(`  👤 Admin User: ${adminUser.username} (password set from SEED_ADMIN_PASSWORD env var)`);

  console.log('\n🎉 Seeding completed successfully!');
  console.log(`\n📊 Summary:`);
  console.log(`   Connectors : ${CONNECTORS.length}`);
  console.log(`   Endpoints  : ${ALL_ENDPOINT_SLUGS.length}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });


