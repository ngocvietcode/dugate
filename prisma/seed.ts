// prisma/seed.ts
// Master Seed Script for Dugate Document AI — v2 Architecture

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

const defaultEndpointUrl = 'http://localhost:8000/v1/completions';

// ─── 15 External API Connectors ──────────────────────────────────────────────
const CONNECTORS = [
  // ── Ingest ──────────────────────────────────────────────────────────────
  {
    slug: 'ext-doc-layout',
    name: 'Document Layout Parser',
    description: 'Parse PDF/DOCX → Markdown. Xử lý cả OCR scan. Dùng cho: ingest:parse, ingest:ocr, transform:convert.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'doc-layout-v1' }]),
    responseContentPath: 'content',
    defaultPrompt: `Parse the document and return its full content in well-structured Markdown.
Preserve all tables, headings, lists, and formatting. Output format: {{output_format}}.`,
  },
  {
    slug: 'ext-vision-reader',
    name: 'Handwriting Vision Reader',
    description: 'Số hóa tài liệu viết tay bằng vision model. Dùng cho: ingest:digitize.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'content',
    defaultPrompt: `Transcribe all handwritten text in this document image to digital text. Preserve paragraph structure.`,
  },
  {
    slug: 'ext-pdf-tools',
    name: 'PDF Tools (Split / Merge)',
    description: 'Công cụ xử lý PDF: tách trang, ghép. Dùng cho: ingest:split.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: null,
    responseContentPath: 'content',
    defaultPrompt: `Split PDF at pages: {{pages}}. Return output as downloadable file URL.`,
  },

  // ── Extract ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-data-extractor',
    name: 'Structured Data Extractor',
    description: 'Trích xuất dữ liệu có cấu trúc từ tài liệu. Dùng cho: extract (all types), analyze:fact-check step-1.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Extract structured data from the document. Fields to extract: {{fields}}
{{#if schema}}Output schema: {{schema}}{{/if}}
{{#if business_rules}}Business rules: {{business_rules}}{{/if}}

Return ONLY valid JSON matching the requested fields.`,
  },

  // ── Analyze ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-classifier',
    name: 'Document Classifier',
    description: 'Phân loại tài liệu vào danh mục. Dùng cho: analyze:classify.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Classify this document into one of the following categories: {{categories}}.
Business rules: {{business_rules}}
Return JSON: { "document_type": "string", "confidence": 0.0-1.0, "language": "string", "key_topics": ["string"] }`,
  },
  {
    slug: 'ext-sentiment',
    name: 'Sentiment Analyzer',
    description: 'Phân tích cảm xúc / quan điểm từ tài liệu. Dùng cho: analyze:sentiment.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Analyze the sentiment and tone of this document.
Return JSON: { "overall_sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED", "confidence": 0.0-1.0, "aspects": [{"aspect": "string", "sentiment": "string"}] }`,
  },
  {
    slug: 'ext-compliance',
    name: 'Compliance Checker',
    description: 'Kiểm tra tài liệu theo tiêu chuẩn/quy định. Dùng cho: analyze:compliance.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Check this document for compliance against the following criteria:
{{criteria}}
Business rules: {{business_rules}}

Return JSON: { "verdict": "PASS|FAIL|WARNING", "score": 0-100, "summary": "string", "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "explanation": "string"}] }`,
  },
  {
    slug: 'ext-fact-verifier',
    name: 'Fact Verifier',
    description: 'Kiểm chứng dữ liệu so với reference. Dùng cho: analyze:fact-check step-2.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Verify the extracted data against the reference data provided.
Extracted claims/data: {{input_content}}
Reference data: {{reference_data}}
Business rules: {{business_rules}}

Return JSON: { "verdict": "PASS|FAIL|WARNING", "score": 0-100, "summary": "string", "checks": [{"rule": "string", "status": "PASS|FAIL|WARNING", "document_value": "string", "reference_value": "string", "explanation": "string"}], "discrepancies": ["string"] }`,
  },
  {
    slug: 'ext-quality-eval',
    name: 'Quality & Risk Evaluator',
    description: 'Đánh giá chất lượng và rủi ro tài liệu. Dùng cho: analyze:quality, analyze:risk.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Evaluate the quality and/or risk of this document.
Evaluation criteria: {{criteria}}
Business rules: {{business_rules}}

Return JSON: { "score": 0-100, "grade": "A|B|C|D|F", "summary": "string", "findings": [{"category": "string", "severity": "LOW|MEDIUM|HIGH", "description": "string", "recommendation": "string"}] }`,
  },

  // ── Transform ────────────────────────────────────────────────────────────
  {
    slug: 'ext-translator',
    name: 'Document Translator',
    description: 'Dịch tài liệu sang ngôn ngữ khác. Dùng cho: transform:translate.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 300,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'content',
    defaultPrompt: `Translate this document to {{target_language}}. Tone: {{tone}}.
{{#if glossary}}Glossary: {{glossary}}{{/if}}
Preserve all Markdown formatting. Only translate text content.`,
  },
  {
    slug: 'ext-rewriter',
    name: 'Content Rewriter',
    description: 'Viết lại nội dung theo phong cách/giọng văn. Dùng cho: transform:rewrite.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'content',
    defaultPrompt: `Rewrite the document content with style: {{style}}, tone: {{tone}}.
Preserve the original meaning but improve clarity and professionalism.`,
  },
  {
    slug: 'ext-redactor',
    name: 'PII Redactor & Template Filler',
    description: 'Ẩn thông tin nhạy cảm hoặc điền dữ liệu vào template. Dùng cho: transform:redact, transform:template.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'content',
    defaultPrompt: `Process the document by applying redaction or template filling.
Patterns to redact: {{redact_patterns}}
Template to apply: {{template}}
Return the processed document content.`,
  },

  // ── Generate ─────────────────────────────────────────────────────────────
  {
    slug: 'ext-content-gen',
    name: 'Content Generator',
    description: 'Tạo nội dung mới từ tài liệu: tóm tắt, outline, báo cáo, email. Dùng cho: generate:*, analyze:summarize-eval.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    responseContentPath: 'content',
    defaultPrompt: `Generate content based on the uploaded documents. 
Max words: {{max_words}}. Format: {{format}}. Audience: {{audience}}. Tone: {{tone}}.
Focus areas: {{focus_areas}}.
For evaluation criteria: {{criteria}}.`,
  },
  {
    slug: 'ext-qa-engine',
    name: 'Document QA Engine',
    description: 'Trả lời câu hỏi về nội dung tài liệu. Dùng cho: generate:qa.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Answer the following questions based ONLY on information found in the provided documents.
Questions: {{questions}}

Return JSON: { "answers": [{"question": "string", "answer": "string", "confidence": 0.0-1.0, "source_quote": "string"}] }`,
  },

  // ── Compare ──────────────────────────────────────────────────────────────
  {
    slug: 'ext-comparator',
    name: 'Document Comparator',
    description: 'So sánh 2 hoặc nhiều tài liệu: diff text, semantic, hoặc version changelog. Dùng cho: compare:*.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'files',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 240,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    responseContentPath: 'content',
    defaultPrompt: `Compare the provided documents. Mode: {{mode}}.
Focus areas: {{focus}}.
Business rules: {{business_rules}}.
Output format: {{output_format}}.

Return JSON: { "similarity_score": 0.0-1.0, "summary": "string", "total_changes": 0, "differences": [{"type": "added|removed|modified", "section": "string", "original_text": "string", "changed_text": "string", "significance": "low|medium|high", "explanation": "string"}] }`,
  },
];

// ─── Endpoint slugs from SERVICE_REGISTRY for ProfileEndpoint seeding ─────────
const ALL_ENDPOINT_SLUGS = [
  // ingest
  'ingest:parse', 'ingest:ocr', 'ingest:digitize', 'ingest:split',
  // extract
  'extract', 'extract:invoice', 'extract:contract', 'extract:id-card', 'extract:receipt', 'extract:po', 'extract:payslip',
  // analyze
  'analyze:classify', 'analyze:sentiment', 'analyze:compliance', 'analyze:fact-check',
  'analyze:quality', 'analyze:risk', 'analyze:summarize-eval',
  // transform
  'transform:convert', 'transform:translate', 'transform:rewrite', 'transform:redact', 'transform:template',
  // generate
  'generate:summary', 'generate:outline', 'generate:report', 'generate:email', 'generate:minutes', 'generate:qa',
  // compare
  'compare:diff', 'compare:semantic', 'compare:version',
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Starting Master Data Seed for Dugate Document AI v2...');

  // 1. Seed 15 External API Connectors
  console.log('\n[1/3] Seeding 15 External API Connectors...');
  for (const conn of CONNECTORS) {
    await prisma.externalApiConnection.upsert({
      where: { slug: conn.slug },
      update: {
        // Bỏ việc ghi đè (overwrite) endpointUrl, authKey, defaultPrompt, v.v.
        // để Admin config không bị mất mỗi khi Docker restart/build lại.
        name: conn.name,
        description: conn.description,
      },
      create: conn,
    });
    console.log(`  ✅ ${conn.slug}`);
  }

  // 2. Setup Default Admin API Key
  console.log('\n[2/3] Ensuring Default Admin API Key...');
  const rawAdminKey = 'sk-admin-default-secret-key';
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
  console.log(`  🔑 Admin API Key: ${rawAdminKey} (ID: ${adminKey.id})`);

  // Enable all endpoints for admin
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
  const defaultPassword = '123456';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { password: hashedPassword, role: 'ADMIN' },
    create: { username: 'admin', password: hashedPassword, role: 'ADMIN' },
  });
  console.log(`  👤 Admin User: ${adminUser.username} / ${defaultPassword}`);

  console.log('\n🎉 Seeding completed successfully!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
