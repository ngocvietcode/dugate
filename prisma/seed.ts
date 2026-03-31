// prisma/seed.ts
// Master Seed Script for Dugate Document AI Production

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const PDF_DOCX_MIMES = 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const defaultEndpointUrl = 'http://localhost:8000/v1/external-proxy/completions';

const PREBUILT_PROCESSORS = [
  {
    slug: 'prebuilt-layout',
    displayName: 'Chuyển đổi văn bản (PDF/DOCX → Markdown)',
    type: 'PREBUILT',
    category: 'extract',
    description: 'Chuyển đổi tài liệu PDF hoặc DOCX sang Markdown giữ nguyên cấu trúc bảng biểu, heading, và hình ảnh.',
    systemPrompt: 'Convert the document content to well-structured Markdown. Preserve all tables, headings, lists, and formatting.',
    responseSchema: null,
    acceptedMimes: PDF_DOCX_MIMES,
    outputFormats: 'md,html',
    variablesSchema: null,
    canBeFirstStep: true,
    canBeChainStep: false,
    processorConfig: JSON.stringify({ docxMode: 'ai', docxFormat: 'html', compressLevel: 'ebook' }),
  },
  {
    slug: 'prebuilt-compare',
    displayName: 'So sánh ngữ nghĩa 2 văn bản',
    type: 'PREBUILT',
    category: 'analyze',
    description: 'Phân tích sự khác biệt ngữ nghĩa giữa file gốc và file chỉnh sửa.',
    systemPrompt: 'Compare the following two documents semantically. Identify all changes: added, removed, and modified sections. For each change provide: type (added/removed/modified), section, original_text, changed_text, significance (low/medium/high), explanation.',
    responseSchema: JSON.stringify({
      type: 'object',
      properties: {
        similarity_score: { type: 'number' },
        total_changes: { type: 'number' },
        differences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['added', 'removed', 'modified'] },
              section: { type: 'string' },
              original_text: { type: 'string' },
              changed_text: { type: 'string' },
              significance: { type: 'string' },
              explanation: { type: 'string' },
            },
          },
        },
      },
    }),
    acceptedMimes: PDF_DOCX_MIMES,
    outputFormats: 'json',
    variablesSchema: null,
    canBeFirstStep: true,
    canBeChainStep: false,
    processorConfig: JSON.stringify({ docxMode: 'ai', docxFormat: 'html', compressLevel: 'ebook' }),
  }
];

const CONNECTORS = [
  {
    slug: 'ext-claim-extractor',
    name: 'Claim Extractor (Fact Check Step 1)',
    description: 'Trích xuất các nhận định (claims), số liệu, và sự kiện quan trọng từ tài liệu.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'temperature', value: '0.1' }]),
    defaultPrompt: `Extract all factual claims, numeric figures, entities, dates, and key statements from the document. 
Return ONLY a valid JSON list of strings representing these claims.

---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-fact-verifier',
    name: 'Fact Verifier (Fact Check Step 2)',
    description: 'Kiểm tra và đối chiếu các thông tin dựa trên dữ liệu tham chiếu (Reference Data).',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'temperature', value: '0.1' }]),
    defaultPrompt: `You are a professional document compliance and fact-checking auditor.

**TASK:** Verify the document content against the provided reference data, following the business rules specified below.

---

**BUSINESS RULES / CHECK CRITERIA:**
{{check_prompt}}

---

**REFERENCE DATA:**
{{reference_text}}

---

**DOCUMENT CONTENT:**
{{input_content}}

---

**Instructions:**
Carefully compare the document content against the reference data for each rule or criterion. For each check:
- Extract the exact value/statement from the document
- Compare it with the corresponding value in the reference data
- Assign a status: PASS (matches/compliant), FAIL (contradicts/non-compliant), WARNING (partially matches or ambiguous), NOT_APPLICABLE (rule doesn't apply to this document)

Return ONLY a valid JSON object with this exact structure (no markdown fences, no extra text outside JSON):
{
  "verdict": "PASS | FAIL | WARNING | INCONCLUSIVE",
  "score": <integer 0-100, overall compliance percentage>,
  "summary": "<2-3 sentence overall compliance assessment>",
  "checks": [
    {
      "rule": "<specific rule or criterion checked>",
      "status": "PASS | FAIL | WARNING | NOT_APPLICABLE",
      "document_value": "<exact value or text found in the document>",
      "reference_value": "<corresponding expected value from reference data>",
      "explanation": "<concise explanation of why this check passed or failed>"
    }
  ],
  "discrepancies": ["<list of key discrepancies found, each as a concise statement>"]
}`,
  },
  {
    slug: 'ext-invoice-extractor',
    name: 'Invoice Extractor',
    description: 'Trích xuất dữ liệu từ hóa đơn VAT: số hóa đơn, người bán, tổng tiền, thuế.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 120,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    defaultPrompt: `Extract structured data from this invoice document. Return strictly a JSON object matching this schema:
{
  "invoice_no": "string",
  "date": "string",
  "seller_name": "string",
  "seller_tax_code": "string",
  "buyer_name": "string",
  "items": [{"description": "string", "quantity": "number", "unit_price": "number", "amount": "number"}],
  "subtotal": "number",
  "vat_amount": "number",
  "total_amount": "number",
  "currency": "string"
}

---
BUSINESS RULES: {{business_rules}}
---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-contract-extractor',
    name: 'Contract Extractor',
    description: 'Trích xuất các điều khoản, bên ký kết, thời hạn, và cam kết từ hợp đồng.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 180,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    defaultPrompt: `Extract structured data from this contract document. Return strictly a JSON with:
{
  "parties": ["string"],
  "effective_date": "string",
  "expiry_date": "string",
  "key_clauses": [{"clause_number": "string", "title": "string", "summary": "string"}],
  "total_value": "string"
}

---
BUSINESS RULES: {{business_rules}}
---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-id-card-extractor',
    name: 'ID Card Extractor',
    description: 'Trích xuất thông tự ảnh/scan Căn cước công dân hoặc Chứng minh nhân dân.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 100,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }, { key: 'response_format', value: 'json_object' }]),
    defaultPrompt: `Extract structured data from this identity card document. Return JSON with fields:
{
  "full_name": "string",
  "date_of_birth": "string",
  "gender": "string",
  "nationality": "string",
  "place_of_origin": "string",
  "place_of_residence": "string",
  "id_number": "string",
  "expiry_date": "string"
}

---
BUSINESS RULES: {{business_rules}}
---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-document-classifier',
    name: 'Document Classifier',
    description: 'Tự động phân loại tài liệu thuộc loại gì: Hóa đơn, Hợp đồng, CV, Báo cáo...',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 60,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }, { key: 'response_format', value: 'json_object' }]),
    defaultPrompt: `Classify this document into one of the following categories: {{categories}}.
Return JSON with:
{
  "document_type": "string",
  "confidence": "number (0-1)",
  "language": "string",
  "page_count_estimate": "number",
  "key_topics": ["string"]
}

---
BUSINESS RULES: {{business_rules}}
---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-summarize',
    name: 'Document Summarizer',
    description: 'Tóm tắt nội dung tài liệu theo độ dài và phong cách yêu cầu.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 150,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o-mini' }]),
    defaultPrompt: `Summarize the following document content in {{max_words}} words or less. Write in a clear, professional tone. Preserve key facts and figures.
Focus Areas: {{focus_areas}}
Tone: {{tone}}

---
DOCUMENT CONTENT:
{{input_content}}`,
  },
  {
    slug: 'ext-translate',
    name: 'Document Translator',
    description: 'Dịch toàn bộ tài liệu sang ngôn ngữ đích, giữ nguyên cấu trúc Markdown.',
    endpointUrl: defaultEndpointUrl,
    httpMethod: 'POST',
    promptFieldName: 'prompt',
    fileFieldName: 'file',
    authType: 'API_KEY_HEADER',
    authKeyHeader: 'x-api-key',
    authSecret: 'DUMMY_SECRET_KEY',
    timeoutSec: 300,
    state: 'ENABLED',
    staticFormFields: JSON.stringify([{ key: 'model', value: 'gpt-4o' }]),
    defaultPrompt: `Translate the following document to {{target_language}}. 
Tone: {{tone}}
Glossary instructions: {{glossary}}

CRITICAL: Preserve ALL Markdown formatting including headings, tables, lists, bold, italic, and code blocks exactly as they are. Only translate the text content.

---
DOCUMENT CONTENT:
{{input_content}}`,
  }
];

// Map endpoints from ENDPOINT_REGISTRY logic
const ENDPOINT_SLUGS = [
  'layout',
  'summarize',
  'translate',
  'invoice-extractor',
  'contract-extractor',
  'id-card-extractor',
  'document-classifier',
  'fact-check',
  'compare'
];

async function main() {
  console.log('🌱 Starting Master Data Seed for Production...');

  // 1. Seed Legacy/Local Processors
  console.log('\\n[1/4] Seeding Legacy/Local Processors...');
  for (const proc of PREBUILT_PROCESSORS) {
    await prisma.processor.upsert({
      where: { slug: proc.slug },
      update: { ...proc },
      create: { ...proc },
    });
    console.log(`  ✅ ${proc.slug}`);
  }

  // 2. Seed External API Connectors
  console.log('\\n[2/4] Seeding External API Connectors...');
  for (const conn of CONNECTORS) {
    await prisma.externalApiConnection.upsert({
      where: { slug: conn.slug },
      update: { ...conn },
      create: { ...conn },
    });
    console.log(`  ✅ ${conn.slug}`);
  }

  // 3. Setup Default Admin Hash Key
  console.log('\\n[3/4] Ensuring Default Admin API Key...');
  // WARNING: This hash corresponds to 'sk-admin-default-secret-key'. Change it on production.
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
  console.log(`  🔑 System Admin API Key seeded (ID: ${adminKey.id})`);
  console.log(`  ℹ️  Default key raw string: ${rawAdminKey}`);

  // 4. Enroll Admin to All Profile Endpoints
  console.log('\\n[4/4] Generating ProfileEndpoints for Admin API Key...');
  for (const slug of ENDPOINT_SLUGS) {
    await prisma.profileEndpoint.upsert({
      where: {
        apiKeyId_endpointSlug: {
          apiKeyId: adminKey.id,
          endpointSlug: slug,
        },
      },
      update: { enabled: true },
      create: {
        apiKeyId: adminKey.id,
        endpointSlug: slug,
        enabled: true,
      },
    });
    console.log(`  📡 Enabled ProfileEndpoint: ${slug}`);
  }

  console.log('\\n🎉 Master Data Seeding completed successfully!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
