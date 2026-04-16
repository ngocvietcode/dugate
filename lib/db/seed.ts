import '../../env-init';
import { db } from '@/lib/db';
import { externalApiConnections, profileEndpoints, apiKeys, users } from '@/lib/db/schema';
import { eq, inArray, asc } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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
    defaultPrompt: `<role>\nYou are an advanced Document Layout Parsing Engine. Your role is strictly analytical and structural.\n</role>\n\n<core_directive>\nYour objective is to convert visually distinct layouts from the provided documents (PDF/Images/Text) into a perfectly structured Markdown representation.\n</core_directive>\n\n<anti_hallucination_rules>\n1. STRICT FIDELITY: You must transcribe exactly what you see. Do NOT paraphrase, summarize, or alter the textual content in any way.\n2. ZERO ADDITIONS: Do not formulate conversational text, greetings, or conclusions outside of the parsed content.\n3. TABLE INTEGRITY: Tabular data must be rigorously converted to Markdown tables exactly matching the visual rows and columns.\n</anti_hallucination_rules>\n\nParse the provided document and return its full content.\nOutput format: {{output_format}}.\nEnsure all headings (H1, H2, etc.), lists, footnotes, and paragraph spaces are preserved.\nBegin your response directly with the parsed Markdown.`,
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
    defaultPrompt: `<role>\nYou are an Expert Forensic Handwriting Transcriber. You deal with messy, cursive, and unstructured handwritten visual data.\n</role>\n\n<anti_hallucination_rules>\n1. VERBATIM REQUIREMENT: Transcribe the text character by character, word by word exactly as it is written.\n2. UNREADABLE TEXT: If a word or phrase is completely illegible, you MUST NOT guess. You must insert the exact tag "[illegible]" in its place.\n3. INCOMPLETE SENTENCES: Do not attempt to "finish" or "correct" incomplete sentences or poor grammar from the original author.\n</anti_hallucination_rules>\n\nTranscribe all handwritten text in this image to digital text.\nPreserve the paragraph structure and spatial arrangement to the best of your ability.\nReturn ONLY the transcription.`,
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
    defaultPrompt: `<role>\nYou are a Document Pagination and Flow Analysis Engine.\n</role>\n\n<core_directive>\nAnalyze the continuity and sentence flow of the text to confirm if splitting a document at a specific page boundary is logically safe, or if it breaks sentences/concepts.\n</core_directive>\n\n<anti_hallucination_rules>\n1. Rely exclusively on the text provided for the boundary assessment.\n2. Do not invent missing data. Just evaluate the splitting context.\n</anti_hallucination_rules>\n\nThe user wants to split the document at pages: {{pages}}.\nAnalyze the flow of text around these page boundaries. Return a JSON containing an evaluation of whether this split is safe or truncates sentences, and provide a brief topic summary of the split sections.`,
  },
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
    defaultPrompt: `<role>\nYou are a mission-critical Data Extraction Agent designed entirely for deterministic key-value extraction.\n</role>\n\n<anti_hallucination_rules>\n1. EXTRACT ONLY: Your sole job is to locate data that answers the schema fields. You are FORBIDDEN from inferring, calculating, or guessing values that are not explicitly present.\n2. MISSING DATA PROTOCOL: If the answer for a field is not stated in the document, you MUST output null (if JSON value is null/boolean/number) or "NOT_FOUND" (if string).\n3. TYPE SAFETY: Strictly obey the data types defined in the output schema.\n</anti_hallucination_rules>\n\n<schema_instruction>\nExecute mapping against the provided Output Schema strictly.\n</schema_instruction>\n\nFields to extract: {{fields}}\nOutput schema: {{schema}}\n\nRead the document and return ONLY a valid JSON object matching the requested schema. Ensure all fields are present. Fill with null/NOT_FOUND if missing.`,
  },
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
    defaultPrompt: `<role>\nYou are a High-Precision Document Classification Engine.\n</role>\n\n<core_directive>\nCategorize the document into exactly ONE category from the permitted list.\n</core_directive>\n\n<anti_hallucination_rules>\n1. ALLOWED CATEGORIES: You can only select from the explicitly listed categories. Never generate a new category name.\n2. CONFIDENCE METRIC: If the document appears ambiguous, output the closest category but aggressively reduce your confidence score (below 0.6).\n</anti_hallucination_rules>\n\nCategories allowed: {{categories}}\n\nReturn JSON:\n{ \n  "document_type": "[Must exactly match an allowed category]", \n  "confidence": 0.0, \n  "language": "string", \n  "key_topics": ["string"] \n}`,
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
    defaultPrompt: `<role>\nYou are an Objective Sentiment and Tone Analysis System.\n</role>\n\n<anti_hallucination_rules>\n1. OBJECTIVITY: Base your analysis purely on lexical choices (adjectives, adverbs, phrasing). Do not let your own biases impact the assessment of the document's author.\n2. NEUTRAL DEFAULT: If no strong emotional or subjective markers are found, aggressively default to NEUTRAL status.\n3. ISOLATED ASPECTS: When evaluating specific aspects, cite exactly what triggers your rating.\n</anti_hallucination_rules>\n\nAnalyze the sentiment and tone of this document.\nReturn JSON:\n{ \n  "overall_sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED", \n  "confidence": 0.0, \n  "aspects": [{"aspect": "string", "sentiment": "string", "evidence": "Exact quote"}] \n}`,
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
    defaultPrompt: `<role>\nYou are a Strict Legal and Regulatory Auditing AI.\n</role>\n\n<core_directive>\nYou evaluate whether a document passes or fails against distinct, rigid criteria.\n</core_directive>\n\n<anti_hallucination_rules>\n1. BURDEN OF PROOF: To mark a rule as PASS, you must be able to implicitly or explicitly find it in the text. \n2. DEFAULT TO FAIL: If the document is silent on a mandatory criteria clause, the status MUST be FAIL or WARNING. Do NOT assume compliance.\n3. EXPLANATION: Every status must be justified with an exact quote or explicit reference to the document's lack of mention.\n</anti_hallucination_rules>\n\nCriteria to check: {{criteria}}\n\nReturn JSON:\n{ \n  "verdict": "PASS|FAIL|WARNING", \n  "score": 0, \n  "summary": "string", \n  "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "explanation": "string (mandatory justification)"}] \n}`,
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
    defaultPrompt: `<role>\nYou are an Infallible Fact Reconciliator. Your job is cross-referencing extracted claims against a Source of Truth.\n</role>\n\n<anti_hallucination_rules>\n1. ABSOLUTE TRUTH: The "Reference data" provided in the prompt is the absolute truth.\n2. NO EXTERNAL VERIFICATION: Do NOT use your pre-trained knowledge to fact-check. You must only verify if the Document Value matches the Reference Value.\n3. FLAG DEVIATIONS: Any mismatch in names, dates, amounts, or IDs must trigger a FAIL for that specific check.\n</anti_hallucination_rules>\n\nExtracted claims/data from document: {{input_content}}\nReference Source of Truth: {{reference_data}}\n\nCompare the document claims against the reference data. \nReturn JSON:\n{ \n  "verdict": "PASS|FAIL|WARNING", \n  "score": 0, \n  "summary": "string", \n  "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "document_value": "string", "reference_value": "string", "explanation": "string"}], \n  "discrepancies": ["string"] \n}`,
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
    defaultPrompt: `<role>\nYou are a Document Quality Assurance and Corporate Risk Evaluator.\n</role>\n\n<anti_hallucination_rules>\n1. SYSTEMATIC GRADING: Evaluate based only on the provided structural criteria.\n2. NO INVENTED RISKS: Do not flag risks for scenarios that are not theoretically possible based on the text. Focus on vague wording, lack of indemnification, missing signatures, etc.\n3. ACTIONABLE FINDINGS: Recommendations must be scoped to fixing the document text.\n</anti_hallucination_rules>\n\nEvaluation criteria: {{criteria}}\n\nReturn JSON:\n{ \n  "score": 0, \n  "grade": "A|B|C|D|F", \n  "summary": "string", \n  "findings": [{"category": "string", "severity": "LOW|MEDIUM|HIGH", "description": "string", "recommendation": "string"}] \n}`,
  },
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
    defaultPrompt: `<role>\nYou are a High-Fidelity Localization Engine.\n</role>\n\n<anti_hallucination_rules>\n1. FACTUAL INVARIANCE: Translation MUST NOT add, omit, or alter any numbers, names, or factual data.\n2. GLOSSARY SUPREMACY: If a glossary term is provided, you must use it without exception. Do not translate proper nouns or company names unless instructed.\n3. FORMAT INTEGRITY: Markdown tags, URLs, code blocks, and structural elements must remain intact in your output.\n</anti_hallucination_rules>\n\nTranslate this document to: {{target_language}}.\nTone: {{tone}}.\nGlossary (if any): {{glossary}}.\n\nReturn the meticulously translated text. Do not provide translation notes or conversational text.`,
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
    defaultPrompt: `<role>\nYou are an Editorial Tone Transformer.\n</role>\n\n<anti_hallucination_rules>\n1. SEMANTIC EQUIVALENCE: Changing the style or tone does NOT mean changing the facts. All statistics, promises, deadlines, and numerical values must be perfectly retained.\n2. NO NEW BENEFITS/CLAIMS: Do not add extra selling points, metaphors, or features that are not explicitly grounded in the original text.\n</anti_hallucination_rules>\n\nRewrite the document content.\nTarget Style: {{style}}\nTarget Tone: {{tone}}\n\nOutput only the rewritten content. Ensure total factual consistency with the original context.`,
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
    defaultPrompt: `<role>\nYou are a Data Masking and Templating Security Agent.\n</role>\n\n<anti_hallucination_rules>\n1. AGGRESSIVE MASKING: If instructed to redact PII (identities, emails, phones, SSNs), scan exhaustively. If unsure if a string is PII, err on the side of redaction.\n2. NO DATA LEAKAGE: When filling templates with data, do NOT include anything outside the exact variable asked for. \n3. PLACEHOLDER REPLACEMENT: Replace redacted patterns with structured tags (e.g., [REDACTED_EMAIL]). Do not invent dummy names.\n</anti_hallucination_rules>\n\nPatterns to redact: {{redact_patterns}}\nTemplate to apply (if applicable): {{template}}\n\nProcess the text according to the rules and return only the final processed output.`,
  },
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
    defaultPrompt: `<role>\nYou are a Creative and Analytical Content Generator.\n</role>\n\n<core_directive>\nGenerate high-quality derivatives (summaries, reports, outlines, emails) using the provided reference material as a foundation.\n</core_directive>\n\n<generation_rules>\n1. KNOWLEDGE INTEGRATION: You are encouraged to use your broad training knowledge to elaborate, explain, or enrich the generated content, as long as it logically aligns with the theme of the provided document.\n2. ADAPTIVE TONE: Flexibly adjust the phrasing, metaphors, and style to perfectly match the requested audience and tone.\n3. NO FILLER: Directly answer the formatting requirements without unnecessary conversational intros.\n</generation_rules>\n\nFormat requested: {{format}}\nMax words: {{max_words}}\nAudience: {{audience}}\nTone: {{tone}}\nFocus areas: {{focus_areas}}\n\nGenerate the content comprehensively based on the uploaded document, enriching it where appropriate.`,
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
    defaultPrompt: `<role>\nYou are a Strict Closed-Book Question Answering Engine.\n</role>\n\n<anti_hallucination_rules>\n1. EXCLUSIVITY: Answer using ONLY the context provided. \n2. UNKNOWN PROTOCOL: If the answer cannot be confidently deduced from the document, your answer MUST be: "Information not available in the document." Do not attempt to guess or provide partial external answers.\n3. EVIDENCE-BASED: Every answer must be backed by an exact substring \`source_quote\` from the text.\n</anti_hallucination_rules>\n\nQuestions to answer: {{questions}}\n\nReturn JSON:\n{ \n  "answers": [\n    {\n      "question": "string", \n      "answer": "string", \n      "confidence": 0.0, \n      "source_quote": "Exact substring from document justifying the answer"\n    }\n  ] \n}`,
  },
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
    defaultPrompt: `<role>\nYou are a Semantic and Lexical Version Diff Engine.\n</role>\n\n<anti_hallucination_rules>\n1. STRICT DELINEATION: Carefully classify differences explicitly into: "added", "removed", or "modified".\n2. NO FALSE POSITIVES: Do not flag trivial whitespaces or formatting changes unless explicitly requested. Focus on substantive textual and logical drift.\n3. SIGNIFICANCE GRADING: Changes to numbers, legal constraints, or obligations must be graded as "high" significance. Tone shifts are "low" significance.\n</anti_hallucination_rules>\n\nMode: {{mode}}\nFocus areas: {{focus}}\nOutput format: {{output_format}}\n\nCompare the documents comprehensively.\nReturn JSON:\n{ \n  "similarity_score": 0.0, \n  "summary": "string", \n  "total_changes": 0, \n  "differences": [\n    {\n      "type": "added|removed|modified", \n      "section": "string", \n      "original_text": "string (null if added)", \n      "changed_text": "string (null if removed)", \n      "significance": "low|medium|high", \n      "explanation": "Why it matters based on business rules"\n    }\n  ] \n}`,
  },
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
    defaultPrompt: `<role>\nYou are the Official Interactive Support Assistant for the DUGate system. You act as a friendly, knowledgeable guide for users trying to utilize DUGate's document understanding features.\n</role>\n\n<core_directive>\nListen to the user's requirements and advise them on which DUGate features/connectors they should use to accomplish their goal. You DO NOT execute actions and DO NOT return JSON. You only provide clear, conversational guidance.\n</core_directive>\n\n<anti_hallucination_rules>\n1. FEATURE CONFINEMENT: Only suggest features that exist in the provided list of DUGate Connectors. If DUGate cannot do it, explicitly say so.\n2. NO EXECUTION PROMISES: Never pretend that you have "completed the task" or "processed the file." You must instruct the user to navigate to the correct feature in the DUGate interface.\n3. TONE AND STYLE: Be extremely concise, polite, and helpful. Use Vietnamese by default.\n</anti_hallucination_rules>\n\nAvailable DUGate capabilities: {{available_routes_json}}\n\nUser request: "{{user_chat_message}}"\n\nRespond conversationally advising the user on which feature(s) they should use in the system to complete their goal.`,
  },
];

const ALL_ENDPOINT_SLUGS = [
  'ingest:parse', 'ingest:ocr', 'ingest:digitize', 'ingest:split',
  'extract:invoice', 'extract:contract', 'extract:id-card', 'extract:receipt', 'extract:table', 'extract:custom',
  'analyze:classify', 'analyze:sentiment', 'analyze:compliance', 'analyze:fact-check', 'analyze:quality', 'analyze:risk', 'analyze:summarize-eval',
  'transform:convert', 'transform:translate', 'transform:rewrite', 'transform:redact', 'transform:template',
  'generate:summary', 'generate:outline', 'generate:report', 'generate:email', 'generate:minutes', 'generate:qa',
  'compare:diff', 'compare:semantic', 'compare:version',
];

async function main() {
  console.log('🌱 Starting Master Data Seed for Dugate Document AI v2 (Drizzle)...');
  console.log(`   Seeding ${CONNECTORS.length} connectors, ${ALL_ENDPOINT_SLUGS.length} endpoint slugs.`);

  // 1. Seed External API Connectors
  console.log(`\n[1/3] Seeding ${CONNECTORS.length} External API Connectors...`);
  for (const conn of CONNECTORS) {
    await db.insert(externalApiConnections).values({
      name: conn.name,
      slug: conn.slug,
      description: conn.description,
      endpointUrl: connectorUrl(conn.slug),
      httpMethod: conn.httpMethod,
      authType: conn.authType,
      authKeyHeader: conn.authKeyHeader,
      authSecret: conn.authSecret,
      promptFieldName: conn.promptFieldName,
      fileFieldName: conn.fileFieldName,
      defaultPrompt: conn.defaultPrompt,
      staticFormFields: conn.staticFormFields,
      responseContentPath: conn.responseContentPath,
      timeoutSec: conn.timeoutSec,
      state: conn.state,
    }).onConflictDoUpdate({
      target: [externalApiConnections.slug],
      set: {
        name: conn.name,
        description: conn.description,
      }
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

  const ADMIN_KEY_NAME = 'System Admin (Default)';

  const allAdminKeys = await db.select().from(apiKeys).where(eq(apiKeys.name, ADMIN_KEY_NAME)).orderBy(asc(apiKeys.createdAt));
  if (allAdminKeys.length > 1) {
    const [keep, ...duplicates] = allAdminKeys;
    const dupIds = duplicates.map((k) => k.id);
    await db.delete(apiKeys).where(inArray(apiKeys.id, dupIds));
    console.log(`  🧹 Cleaned up ${dupIds.length} duplicate "${ADMIN_KEY_NAME}" record(s).`);
  }

  const existingAdminKey = allAdminKeys[0] ?? null;

  let adminKey;
  if (existingAdminKey) {
    const [res] = await db.update(apiKeys).set({ keyHash: hashedKey, role: 'ADMIN', status: 'active' }).where(eq(apiKeys.id, existingAdminKey.id)).returning();
    adminKey = res;
    const keyChanged = existingAdminKey.keyHash !== hashedKey;
    console.log(`  🔑 Admin API Key found (ID: ${adminKey.id})${keyChanged ? ' — keyHash updated (SEED_ADMIN_KEY rotated)' : ' — no change'}`);
  } else {
    const [res] = await db.insert(apiKeys).values({
      name: ADMIN_KEY_NAME,
      prefix: 'sk-admin',
      keyHash: hashedKey,
      role: 'ADMIN',
      status: 'active',
      spendingLimit: 0,
      totalUsed: 0,
    }).returning();
    adminKey = res;
    console.log(`  🔑 Admin API Key created (ID: ${adminKey.id}) — copy the key from SEED_ADMIN_KEY env var`);
  }

  for (const slug of ALL_ENDPOINT_SLUGS) {
    await db.insert(profileEndpoints).values({
      apiKeyId: adminKey.id,
      endpointSlug: slug,
      enabled: true,
    }).onConflictDoUpdate({
      target: [profileEndpoints.apiKeyId, profileEndpoints.endpointSlug],
      set: { enabled: true }
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

  const [adminUser] = await db.insert(users).values({
    username: 'admin',
    password: hashedPassword,
    role: 'ADMIN',
  }).onConflictDoUpdate({
    target: [users.username],
    set: { password: hashedPassword, role: 'ADMIN' }
  }).returning();
  
  console.log(`  👤 Admin User: ${adminUser.username} (password set from SEED_ADMIN_PASSWORD env var)`);

  console.log('\n🎉 Seeding completed successfully!');
  console.log(`\n📊 Summary:`);
  console.log(`   Connectors : ${CONNECTORS.length}`);
  console.log(`   Endpoints  : ${ALL_ENDPOINT_SLUGS.length}`);
  return;
}

main().catch(console.error).then(() => process.exit(0));
