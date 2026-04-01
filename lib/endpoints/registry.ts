// lib/endpoints/registry.ts
// Centralized SERVICE_REGISTRY — nested 6-service architecture with sub-cases.
// v3: Upgraded with self-documenting JSON Schema metadata for parameters.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParamSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  options?: string[];
  default?: any;
}

export interface SubCaseDef {
  displayName: string;
  description: string;
  /** Parameters clients are allowed to send */
  clientParams: Record<string, ParamSchema>;
  /** Parameters ONLY settable by admin via ProfileEndpoint — blocked from client */
  profileOnlyParams: Record<string, ParamSchema>;
  /** Ordered list of ExternalApiConnection slugs to execute as pipeline */
  connections: string[];
}

export interface ServiceDef {
  slug: string;
  displayName: string;
  route: string;
  /** Form field name that discriminates which sub-case to run */
  discriminatorName: string;
  subCases: Record<string, SubCaseDef>;
}

// ─── Param Constants for Reusability ─────────────────────────────────────────

const PARAMS = {
  output_format: { type: 'string' as const, description: 'Định dạng file kết quả (vd: md, json, html, csv)', options: ['md', 'json', 'html', 'csv'], default: 'json' },
  language: { type: 'string' as const, description: 'Ngôn ngữ của tài liệu', options: ['vi', 'en', 'ja', 'zh'] },
  pages: { type: 'string' as const, description: 'Trang cần xử lý (vd: "1", "1-5", "1,3,5")' },
  type: { type: 'string' as const, description: 'Loại tài liệu cần trích xuất (invoice, contract...)' },
  fields: { type: 'string' as const, description: 'Danh sách các trường cần trích xuất tự do (tách nhau bằng dấu phẩy)' },
  schema: { type: 'string' as const, description: 'JSON Schema bắt buộc cho kết quả trích xuất' },
  business_rules: { type: 'string' as const, description: 'Quy định, luật lệ nghiệp vụ cần tuân thủ (Dành cho Admin khóa cứng)' },
  categories: { type: 'string' as const, description: 'Danh sách các nhãn phân loại tài liệu' },
  criteria: { type: 'string' as const, description: 'Tiêu chí đánh giá, chấm điểm tài liệu' },
  reference_data: { type: 'string' as const, description: 'Nguồn dữ liệu gốc/bên ngoài dùng để đối soát sự thật (JSON String)' },
  extract_fields: { type: 'string' as const, description: 'Các trường cần tách ra trước khi fact-check' },
  focus: { type: 'string' as const, description: 'Khía cạnh, điểm chú trọng báo cáo/so sánh (vd: giá tiền, điều khoản đền bù)' },
  focus_areas: { type: 'string' as const, description: 'Chủ đề cấm hoặc bắt buộc (Admin override)' },
  target_language: { type: 'string' as const, description: 'Ngôn ngữ đích muốn dịch ra' },
  tone: { type: 'string' as const, description: 'Giọng điệu văn bản sinh ra', options: ['formal', 'casual', 'business', 'academic'] },
  glossary: { type: 'string' as const, description: 'Bộ từ điển chuyên ngành ép buộc (Admin override)' },
  style: { type: 'string' as const, description: 'Phong cách viết lại', options: ['academic', 'executive', 'simplified', 'bullet_points'] },
  redact_patterns: { type: 'string' as const, description: 'Quy tắc che dữ liệu PII (số thẻ, email...)' },
  template: { type: 'string' as const, description: 'Tên hoặc nội dung template tái cấu trúc' },
  max_words: { type: 'number' as const, description: 'Giới hạn số từ tối đa trả về' },
  format: { type: 'string' as const, description: 'Kiểu format trình bày', options: ['paragraph', 'bullets', 'numbered', 'table'] },
  audience: { type: 'string' as const, description: 'Đối tượng người đọc hướng tới' },
  questions: { type: 'string' as const, description: 'Danh sách câu hỏi cần QA cho tài liệu' },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const SERVICE_REGISTRY: Record<string, ServiceDef> = {

  // ── 1. Ingest ─────────────────────────────────────────────────────────────
  ingest: {
    slug: 'ingest',
    displayName: 'Document Ingestion',
    route: 'POST /api/v1/ingest',
    discriminatorName: 'mode',
    subCases: {
      parse: {
        displayName: 'Parse Structure',
        description: 'Parse PDF/DOCX → Markdown/HTML/Text',
        clientParams: { output_format: PARAMS.output_format, language: PARAMS.language },
        profileOnlyParams: {},
        connections: ['ext-doc-layout'],
      },
      ocr: {
        displayName: 'OCR',
        description: 'Nhận dạng ký tự từ ảnh/scan',
        clientParams: { language: PARAMS.language },
        profileOnlyParams: {},
        connections: ['ext-doc-layout'],
      },
      digitize: {
        displayName: 'Handwriting Digitizer',
        description: 'Số hóa tài liệu viết tay',
        clientParams: {},
        profileOnlyParams: {},
        connections: ['ext-vision-reader'],
      },
      split: {
        displayName: 'PDF Split',
        description: 'Tách trang PDF theo điều kiện',
        clientParams: { pages: PARAMS.pages },
        profileOnlyParams: {},
        connections: ['ext-pdf-tools'],
      },
    },
  },

  // ── 2. Extract ────────────────────────────────────────────────────────────
  extract: {
    slug: 'extract',
    displayName: 'Data Extraction',
    route: 'POST /api/v1/extract',
    discriminatorName: 'type',
    subCases: {
      _default: {
        displayName: 'Custom/Preset Extraction',
        description: 'Trích xuất dữ liệu có cấu trúc. Dùng type= cho preset hoặc fields= cho tùy chỉnh.',
        clientParams: { type: PARAMS.type, fields: PARAMS.fields, schema: PARAMS.schema },
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-data-extractor'],
      },
    },
  },

  // ── 3. Analyze ────────────────────────────────────────────────────────────
  analyze: {
    slug: 'analyze',
    displayName: 'Document Analysis',
    route: 'POST /api/v1/analyze',
    discriminatorName: 'task',
    subCases: {
      classify: {
        displayName: 'Document Classification',
        description: 'Phân loại tài liệu vào danh mục định sẵn',
        clientParams: { categories: PARAMS.categories },
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-classifier'],
      },
      sentiment: {
        displayName: 'Sentiment Analysis',
        description: 'Phân tích cảm xúc / quan điểm',
        clientParams: {},
        profileOnlyParams: {},
        connections: ['ext-sentiment'],
      },
      compliance: {
        displayName: 'Compliance Check',
        description: 'Kiểm tra tuân thủ quy định, chính sách',
        clientParams: { criteria: PARAMS.criteria },
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-compliance'],
      },
      'fact-check': {
        displayName: 'Fact Check',
        description: 'Kiểm chứng thông tin (2-step: extract → verify)',
        clientParams: { reference_data: PARAMS.reference_data, extract_fields: PARAMS.extract_fields },
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-data-extractor', 'ext-fact-verifier'],
      },
      quality: {
        displayName: 'Quality Evaluation',
        description: 'Đánh giá chất lượng nội dung tài liệu',
        clientParams: { criteria: PARAMS.criteria },
        profileOnlyParams: {},
        connections: ['ext-quality-eval'],
      },
      risk: {
        displayName: 'Risk Assessment',
        description: 'Đánh giá rủi ro theo nghiệp vụ',
        clientParams: {},
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-quality-eval'],
      },
      'summarize-eval': {
        displayName: 'Summarize & Evaluate',
        description: 'Tóm tắt tài liệu và đánh giá theo tiêu chí',
        clientParams: { criteria: PARAMS.criteria, focus: PARAMS.focus },
        profileOnlyParams: { focus_areas: PARAMS.focus_areas },
        connections: ['ext-content-gen'],
      },
    },
  },

  // ── 4. Transform ──────────────────────────────────────────────────────────
  transform: {
    slug: 'transform',
    displayName: 'Document Transformation',
    route: 'POST /api/v1/transform',
    discriminatorName: 'action',
    subCases: {
      convert: {
        displayName: 'Format Convert',
        description: 'Chuyển đổi định dạng tài liệu',
        clientParams: { output_format: PARAMS.output_format },
        profileOnlyParams: {},
        connections: ['ext-doc-layout'],
      },
      translate: {
        displayName: 'Translation',
        description: 'Dịch tài liệu sang ngôn ngữ khác',
        clientParams: { target_language: PARAMS.target_language, tone: PARAMS.tone },
        profileOnlyParams: { glossary: PARAMS.glossary },
        connections: ['ext-translator'],
      },
      rewrite: {
        displayName: 'Content Rewrite',
        description: 'Viết lại nội dung theo phong cách/giọng điệu',
        clientParams: { style: PARAMS.style, tone: PARAMS.tone },
        profileOnlyParams: {},
        connections: ['ext-rewriter'],
      },
      redact: {
        displayName: 'PII Redaction',
        description: 'Che/xóa thông tin cá nhân nhạy cảm',
        clientParams: {},
        profileOnlyParams: { redact_patterns: PARAMS.redact_patterns },
        connections: ['ext-redactor'],
      },
      template: {
        displayName: 'Template Apply',
        description: 'Điền dữ liệu vào template tài liệu',
        clientParams: { template: PARAMS.template },
        profileOnlyParams: {},
        connections: ['ext-redactor'],
      },
    },
  },

  // ── 5. Generate ───────────────────────────────────────────────────────────
  generate: {
    slug: 'generate',
    displayName: 'Content Generation',
    route: 'POST /api/v1/generate',
    discriminatorName: 'task',
    subCases: {
      summary: {
        displayName: 'Summarize',
        description: 'Tóm tắt tài liệu theo độ dài và định dạng',
        clientParams: { max_words: PARAMS.max_words, format: PARAMS.format, audience: PARAMS.audience },
        profileOnlyParams: { focus_areas: PARAMS.focus_areas, tone: PARAMS.tone },
        connections: ['ext-content-gen'],
      },
      outline: {
        displayName: 'Outline',
        description: 'Tạo dàn ý / mục lục tài liệu',
        clientParams: { format: PARAMS.format },
        profileOnlyParams: {},
        connections: ['ext-content-gen'],
      },
      report: {
        displayName: 'Report',
        description: 'Tạo báo cáo từ dữ liệu tài liệu',
        clientParams: { tone: PARAMS.tone, audience: PARAMS.audience },
        profileOnlyParams: { focus_areas: PARAMS.focus_areas },
        connections: ['ext-content-gen'],
      },
      email: {
        displayName: 'Email Draft',
        description: 'Soạn thảo email từ context tài liệu',
        clientParams: { tone: PARAMS.tone },
        profileOnlyParams: {},
        connections: ['ext-content-gen'],
      },
      minutes: {
        displayName: 'Meeting Minutes',
        description: 'Tạo biên bản họp từ ghi chú/transcript',
        clientParams: { format: PARAMS.format },
        profileOnlyParams: {},
        connections: ['ext-content-gen'],
      },
      qa: {
        displayName: 'Document QA',
        description: 'Hỏi đáp nội dung tài liệu',
        clientParams: { questions: PARAMS.questions },
        profileOnlyParams: {},
        connections: ['ext-qa-engine'],
      },
    },
  },

  // ── 6. Compare ────────────────────────────────────────────────────────────
  compare: {
    slug: 'compare',
    displayName: 'Document Comparison',
    route: 'POST /api/v1/compare',
    discriminatorName: 'mode',
    subCases: {
      diff: {
        displayName: 'Text Diff',
        description: 'So sánh text line-by-line (structural diff)',
        clientParams: { output_format: PARAMS.output_format },
        profileOnlyParams: {},
        connections: ['ext-comparator'],
      },
      semantic: {
        displayName: 'Semantic Compare',
        description: 'So sánh ngữ nghĩa bằng AI',
        clientParams: { focus: PARAMS.focus },
        profileOnlyParams: { business_rules: PARAMS.business_rules },
        connections: ['ext-comparator'],
      },
      version: {
        displayName: 'Version Changelog',
        description: 'So sánh 2 phiên bản tài liệu → tạo changelog',
        clientParams: { output_format: PARAMS.output_format },
        profileOnlyParams: {},
        connections: ['ext-comparator'],
      },
    },
  },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

export function getAllEndpointSlugs() {
  return Object.entries(SERVICE_REGISTRY).flatMap(([svcSlug, svc]) =>
    Object.entries(svc.subCases).map(([caseKey, sub]) => ({
      slug: caseKey === '_default' ? svcSlug : `${svcSlug}:${caseKey}`,
      displayName: sub.displayName,
      serviceName: svc.displayName,
      serviceSlug: svcSlug,
      discriminatorName: svc.discriminatorName,
      discriminatorValue: caseKey !== '_default' ? caseKey : null,
      description: sub.description,
      connections: sub.connections,
      // Map back to arrays for backward compatibility or return schemas directly
      clientParams: Object.keys(sub.clientParams),
      profileOnlyParams: Object.keys(sub.profileOnlyParams),
      clientParamsSchema: sub.clientParams,
      profileOnlyParamsSchema: sub.profileOnlyParams,
    }))
  );
}
