// lib/endpoints/registry.ts
// Centralized SERVICE_REGISTRY — nested 6-service architecture with sub-cases.
// v3: Upgraded with self-documenting JSON Schema metadata for parameters.

import {
  PDF_EXTENSIONS,
  IMAGE_EXTENSIONS,
  WORD_EXTENSIONS,
  SHEET_EXTENSIONS,
} from '@/lib/upload';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParamSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  options?: string[];
  default?: any;
  /** Whether this parameter defaults to being locked (profile-only) */
  defaultLocked?: boolean;
  /** Ẩn khỏi UI mặc định; admin vẫn add bằng tay nếu cần. */
  hidden?: boolean;
  /** Hướng dẫn nhập giá trị trong Profile UI. */
  placeholder?: string;
  /** Marks a legacy parameter that should be replaced by Profile Integration Auth. */
  deprecated?: boolean;
  /** Render as <textarea> instead of <input> — for long text like PEM keys */
  multiline?: boolean;
  /** Mask value in UI with type="password" — for private keys and secrets */
  isSecret?: boolean;
  /**
   * Only render this param in the Profile UI when a gate condition holds.
   * - `{ param }`            → gate param must be truthy (boolean toggle).
   * - `{ param, equals }`    → gate param's value must equal `equals`.
   */
  showWhen?: { param: string; equals?: string };
}

export interface SubCaseDef {
  displayName: string;
  description: string;
  /** Parameters definition */
  parameters: Record<string, ParamSchema>;
  /** Ordered list of ExternalApiConnection slugs to execute as pipeline */
  connections: string[];
  /** If true, this endpoint is a code-driven workflow (not a linear pipeline) */
  isWorkflow?: boolean;
  /** If true, the sub-case remains callable for backward compatibility but is
   *  hidden from the documented discovery surfaces (sample screens, catalog).
   *  It is NOT part of the officially documented 5-skill surface (see docs/AI_Skills,
   *  docs/AI_CATALOG.html). */
  legacy?: boolean;
}

export interface ServiceDef {
  slug: string;
  displayName: string;
  route: string;
  /** Form field name that discriminates which sub-case to run */
  discriminatorName: string;
  subCases: Record<string, SubCaseDef>;
  /** Deprecated services remain callable (backward compatibility) but are hidden
   *  from discovery surfaces (UI nav, home showcase, /services listing). */
  deprecated?: boolean;
}

// ─── API surface version ───────────────────────────────────────────────────
// v1: legacy 6-skill surface (still served for backward compatibility).
// v2: canonical 5-skill surface per docs/AI_Skills (ingest folded away; split → transform).
export const API_VERSION = 'v2';
export const API_BASE = `/api/${API_VERSION}/docs`;

// ─── Param Constants for Reusability ─────────────────────────────────────────

const PARAMS = {
  output_format: { type: 'string' as const, description: 'Định dạng file kết quả (vd: md, json, html, csv)', options: ['md', 'json', 'html', 'csv'], default: 'json' },
  language: { type: 'string' as const, description: 'Ngôn ngữ của tài liệu', options: ['vi', 'en', 'ja', 'zh'] },
  pages: { type: 'string' as const, description: 'Trang cần xử lý (vd: "1", "1-5", "1,3,5")' },
  type: { type: 'string' as const, description: 'Loại tài liệu cần trích xuất (invoice, contract...)' },
  fields: { type: 'string' as const, description: 'Danh sách các trường cần trích xuất tự do (tách nhau bằng dấu phẩy)' },
  schema: { type: 'string' as const, description: 'JSON Schema bắt buộc cho kết quả trích xuất' },
  
  categories: { type: 'string' as const, description: 'Danh sách các nhãn phân loại tài liệu' },
  criteria: { type: 'string' as const, description: 'Tiêu chí đánh giá, chấm điểm tài liệu' },
  reference_data: { type: 'string' as const, description: 'Nguồn dữ liệu gốc/bên ngoài dùng để đối soát sự thật (JSON String)' },
  extract_fields: { type: 'string' as const, description: 'Các trường cần tách ra trước khi fact-check' },
  focus: { type: 'string' as const, description: 'Khía cạnh, điểm chú trọng báo cáo/so sánh (vd: giá tiền, điều khoản đền bù)' },
  focus_areas: { type: 'string' as const, description: 'Chủ đề cấm hoặc bắt buộc (Admin override)' },
  target_language: { type: 'string' as const, description: 'Ngôn ngữ đích muốn dịch ra', options: ['vi', 'en', 'ja', 'zh'] },
  tone: { type: 'string' as const, description: 'Giọng điệu văn bản sinh ra', options: ['formal', 'casual', 'business', 'academic'] },
  glossary: { type: 'string' as const, description: 'Bộ từ điển chuyên ngành ép buộc (Admin override)' },
  style: { type: 'string' as const, description: 'Phong cách viết lại', options: ['academic', 'executive', 'simplified', 'bullet_points'] },
  redact_patterns: { type: 'string' as const, description: 'Quy tắc che dữ liệu PII (số thẻ, email...)' },
  template: { type: 'string' as const, description: 'Tên hoặc nội dung template tái cấu trúc' },
  max_words: { type: 'number' as const, description: 'Giới hạn số từ tối đa trả về' },
  format: { type: 'string' as const, description: 'Kiểu format trình bày', options: ['paragraph', 'bullets', 'numbered', 'table'] },
  audience: { type: 'string' as const, description: 'Đối tượng người đọc hướng tới' },
  questions: { type: 'string' as const, description: 'Danh sách câu hỏi cần QA cho tài liệu' },
  return_bbox: { type: 'boolean' as const, default: false, description: 'Trả về bounding box (toạ độ chuẩn hoá 0–1000 + chỉ số trang) cho mỗi giá trị trích xuất. Model không hỗ trợ định vị sẽ trả toạ độ null. Mặc định: false.' },
};

// ─── Encryption Params (shared, opt-in per Profile) ──────────────────────────
// Response/webhook encryption per DESIGN-API-SECURITY-ENCRYPTION.md.
// All Admin-locked (defaultLocked) EXCEPT the public keys, which a client may also
// supply per-request. Spread into any workflow sub-case that should support it.
// When encryption_enabled is not set on the Profile, behaviour is 100% unchanged.
const ENCRYPTION_PARAMS: Record<string, ParamSchema> = {
  encryption_enabled: {
    type: 'boolean',
    description:
      'Bật mã hóa response/webhook (AES-256-GCM + RSA-OAEP-256). Mặc định tắt — khi tắt, ' +
      'hành vi giữ nguyên như hiện tại (plaintext). Admin cấu hình trên Profile.',
    default: false,
    defaultLocked: true,
  },
  encryption_mode: {
    type: 'string',
    description:
      'Chế độ mã hóa: "selective" (chỉ mã hóa field chỉ định, giữ envelope plaintext — khuyến nghị) ' +
      'hoặc "full" (mã hóa toàn bộ body). Mặc định "selective".',
    options: ['selective', 'full'],
    default: 'selective',
    defaultLocked: true,
    hidden: true,
    showWhen: { param: 'encryption_enabled' },
  },
  encryption_fields: {
    type: 'string',
    description:
      'Danh sách field cần mã hóa ở chế độ selective, phân tách bằng dấu phẩy. Hỗ trợ: ' +
      'dot-path (a.b.c), [] cho mảng (danh_sach_tai_lieu[].extracted_data.ma_may), và ' +
      '** (wildcard sâu) để mã hóa field ở MỌI vị trí xuất hiện — dùng "**.ma_may" khi field ' +
      'lặp lại ở nhiều nơi (result, result.pipeline_steps, metadata.pipeline_steps) và để một ' +
      'cấu hình dùng chung cho cả response poll lẫn webhook. Bắt buộc nhập khi encryption_mode = ' +
      '"selective" (không có giá trị mặc định). Nếu không field nào khớp payload, request sẽ báo lỗi ' +
      '(không gửi plaintext).',
    placeholder:
      'VD (khuyến nghị, phủ mọi nơi): **.ma_may  •  hoặc dot-path cụ thể: result.extracted_data.danh_sach_tai_lieu[].extracted_data.ma_may',
    defaultLocked: true,
    hidden: true,
    required: true,
    // Only relevant to selective mode; hidden entirely when mode = full.
    showWhen: { param: 'encryption_mode', equals: 'selective' },
  },
  encryption_metadata_target: {
    type: 'string',
    description:
      'Nơi đặt metadata mã hóa: "body" (chỉ trong JSON), "headers" (chỉ HTTP headers X-Encrypt-*), ' +
      'hoặc "both" (cả hai — khuyến nghị). Mặc định "both".',
    options: ['both', 'body', 'headers'],
    default: 'both',
    defaultLocked: true,
    hidden: true,
    showWhen: { param: 'encryption_enabled' },
  },
  encryption_public_key: {
    type: 'string',
    description:
      'RSA-2048 Public Key (PEM) của bên nhận dùng để wrap AES key. Có thể cấu hình trên Profile ' +
      'hoặc client truyền kèm mỗi request (hoặc dùng encryption_vault_path). Ưu tiên hơn partner_public_key.',
    placeholder: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
    multiline: true,
    hidden: true,
    showWhen: { param: 'encryption_enabled' },
  },
  encryption_vault_path: {
    type: 'string',
    description:
      'Đường dẫn Vault chứa PEM public key. Dùng khi không nhập trực tiếp public key. ' +
      'Admin cấu hình trên Profile.',
    defaultLocked: true,
    hidden: true,
    showWhen: { param: 'encryption_enabled' },
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const SERVICE_REGISTRY: Record<string, ServiceDef> = {

  // ── 1. Ingest (DEPRECATED — folded into extract/transform per docs/AI_Skills) ──
  // Kept callable for backward compatibility with existing v1 clients. Hidden from
  // discovery surfaces. New integrations should use extract (parse/ocr/digitize via
  // extract types) and transform:split.
  ingest: {
    slug: 'ingest',
    displayName: 'Document Ingestion',
    route: 'POST /api/v1/docs/ingest',
    deprecated: true,
    discriminatorName: 'mode',
    subCases: {
      parse: {
        displayName: 'Parse Structure',
        description: 'Đọc cấu trúc file số như PDF/DOCX nguyên bản, sử dụng các công cụ parse layout chuyên dụng để giữ chặt các box văn bản, Header, Footer, cấu trúc bảng biểu và danh sách (list). Dùng cực tốt khi file là native PDF.',
        parameters: {
        output_format: PARAMS.output_format, language: PARAMS.language
      },
        connections: ['ext-doc-layout'],
      },
      ocr: {
        displayName: 'OCR',
        description: 'Áp dụng công nghệ Nhận dạng Ký tự Quang học (Optical Character Recognition) để chuyển đổi ảnh chụp, bản scan tài liệu (PNG/JPG/PDF Scan) thành text. Có khả năng khai báo ngôn ngữ (VD: language=vie,eng) để tăng cường độ chính xác.',
        parameters: {
        language: PARAMS.language
      },
        connections: ['ext-doc-layout'],
      },
      digitize: {
        displayName: 'Handwriting Digitizer',
        description: 'Chuyên dụng xử lý các biểu mẫu (form) điền tay bị méo mó, chữ viết tay nghiêng ngả, form bị scan lệch. Mô hình sẽ nắn chỉnh góc và số hóa chính xác các ô checkbox/text field.',
        parameters: {
        
      },
        connections: ['ext-vision-reader'],
      },
      split: {
        displayName: 'PDF Split',
        description: 'Chỉ cắt ghép/tách rời (split/merge) các trang từ tài liệu gốc. VD: Dùng tham số pages=1-5 để trích xuất 5 trang đầu tiên của cuốn báo cáo thành PDF mới, giảm dung lượng cho các xử lý LLM.',
        parameters: {
        pages: PARAMS.pages
      },
        connections: ['ext-pdf-tools'],
      },
    },
  },

  // ── 2. Extract ────────────────────────────────────────────────────────────
  extract: {
    slug: 'extract',
    displayName: 'Data Extraction',
    route: 'POST /api/v2/docs/extract',
    discriminatorName: 'type',
    subCases: {
      // ── Tín dụng & Giải ngân ──────────────────────────────────────────────
      disbursement: {
        displayName: 'Disbursement Docs',
        description: 'Trích xuất chứng từ giải ngân, giấy nhận nợ, hợp đồng tín dụng: số tiền, kỳ hạn, lãi suất, tài khoản nhận, bên vay/bên cho vay.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      guarantee: {
        displayName: 'Guarantee Docs',
        description: 'Trích xuất hồ sơ bảo lãnh, thư bảo lãnh (BL), hợp đồng bảo đảm: bên bảo lãnh, bên thụ hưởng, giá trị, thời hạn hiệu lực.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      approval: {
        displayName: 'Approval / Resolution',
        description: 'Trích xuất nghị quyết phê duyệt, điều kiện sản phẩm/cấp tín dụng: cấp phê duyệt, hạn mức, điều kiện ràng buộc.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      collateral: {
        displayName: 'Collateral Docs',
        description: 'Trích xuất sổ đỏ, hợp đồng mua bán BĐS, hồ sơ giải chấp: thông tin tài sản, chủ sở hữu, giá trị định giá.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      'credit-report': {
        displayName: 'Credit Report',
        description: 'Trích xuất báo cáo CIC, báo cáo tài chính (BCTC), đơn đề nghị cấp tín dụng: chỉ số tài chính, lịch sử tín dụng, nhóm nợ.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      // ── Thanh toán & Tài trợ Thương mại ───────────────────────────────────
      'payment-order': {
        displayName: 'Payment Order (UNC)',
        description: 'Trích xuất Ủy nhiệm chi (UNC) — bản cứng, fax, email: người chuyển/nhận, số tài khoản, số tiền, nội dung chuyển khoản.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      lc: {
        displayName: 'Letter of Credit',
        description: 'Trích xuất chứng từ L/C, điện SWIFT, B/L, invoice thương mại: số L/C, các bên, điều kiện thanh toán, hàng hoá.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      // ── Onboarding & Pháp lý ──────────────────────────────────────────────
      'business-license': {
        displayName: 'Business License',
        description: 'Trích xuất Giấy ĐKKD, Mã số thuế, Giấy phép kinh doanh: tên doanh nghiệp, MST, người đại diện, ngành nghề, vốn điều lệ.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      'account-form': {
        displayName: 'Account Form',
        description: 'Trích xuất form đăng ký mở/thay đổi tài khoản, hồ sơ CIF: thông tin khách hàng, loại tài khoản, chữ ký mẫu.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      'civil-doc': {
        displayName: 'Civil Document',
        description: 'Trích xuất giấy tờ hộ tịch (giấy đăng ký kết hôn, xác nhận tình trạng hôn nhân): các bên, ngày, nơi cấp.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      // ── Tài sản & Bảo hiểm ────────────────────────────────────────────────
      'vehicle-doc': {
        displayName: 'Vehicle Document',
        description: 'Trích xuất chứng từ xe (giấy kiểm định, phiếu xuất xưởng, COC): số khung, số máy, biển số, chủ xe, thông số kỹ thuật.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      insurance: {
        displayName: 'Insurance Document',
        description: 'Trích xuất Giấy chứng nhận bảo hiểm, hợp đồng bảo hiểm nhà/xe: số hợp đồng, người được bảo hiểm, phạm vi, giá trị, thời hạn.',
        parameters: {},
        connections: ['ext-data-extractor'],
      },
      // ── Hoá đơn & legacy types ────────────────────────────────────────────
      invoice: {
        displayName: 'Invoice Extractor',
        description: 'Chuyên biệt trích xuất hóa đơn VAT, invoice quốc tế. Dữ liệu trả về luôn có các trường cố định: tên/MST nhà cung cấp, thông tin người mua, mã HĐ, tổng tiền cấn trừ thuế, thuế VAT, và mảng line_items (chi tiết mặt hàng).',
        parameters: {
        
      },
        connections: ['ext-data-extractor'],
      },
      contract: {
        displayName: 'Contract Extractor',
        description: 'Trích xuất meta-data từ hợp đồng kinh tế/lao động (bên A/bên B tên gì, điều khoản phạt vi phạm, thời hạn hiệu lực, chữ ký và giá trị ròng của hợp đồng).',
        parameters: {
        
      },
        connections: ['ext-data-extractor'],
      },
      'id-card': {
        displayName: 'ID Card Extractor',
        description: 'Trích xuất chính xác Chứng minh thư/CCCD/Passport theo trường (Số CCCD, Họ tên, Ngày Sinh, Quê quán, Địa chỉ thường trú) chống giả mạo OCR và làm sạch dữ liệu.',
        parameters: {
        
      },
        connections: ['ext-data-extractor'],
      },
      receipt: {
        displayName: 'Receipt Extractor',
        description: 'Tương tự invoice nhưng tối ưu riêng cho biên lai siêu thị, vé xe, hóa đơn bán lẻ qua máy POS (in nhiệt, mờ chữ) giúp hệ thống quản lý chi phí (Expense Management) nhập liệu tự động.',
        parameters: {
        
      },
        connections: ['ext-data-extractor'],
        legacy: true,
      },
      custom: {
        displayName: 'Custom Extractor',
        description: 'Trích xuất siêu linh hoạt theo chuẩn động (Dynamic schema). Client truyền cấu trúc mình muốn (JSON schema) qua tham biến schema hoặc chuỗi fields="[tên_khách, sdt, dia_chi_giao_hang]".',
        parameters: {
        fields: PARAMS.fields, schema: PARAMS.schema, 
        
      },
        connections: ['ext-data-extractor'],
      },
    },
  },

  // ── 3. Analyze ────────────────────────────────────────────────────────────
  analyze: {
    slug: 'analyze',
    displayName: 'Document Analysis',
    route: 'POST /api/v2/docs/analyze',
    discriminatorName: 'task',
    subCases: {
      classify: {
        displayName: 'Document Classification',
        description: 'Tự động phân loại tài liệu vào các Taxonomy cho trước. (VD: Đưa một đống hồ sơ tự động phân vào thư mục "Hợp đồng", "Hóa đơn", "Báo cáo", "CV"). Hữu ích cho phân luồng Routing nội bộ hệ thống.',
        parameters: {
        categories: PARAMS.categories, 
        
      },
        connections: ['ext-classifier'],
      },
      sentiment: {
        displayName: 'Sentiment Analysis',
        description: 'Phân tích thái độ/cảm xúc nội dung (Tích cực/Tiêu cực/Trung tính/Cáu giận) kèm theo giải thích nguyên nhân do đâu. Rất phù hợp nếu feed vào dữ liệu là các bài Review của khách hàng.',
        parameters: {
        
      },
        connections: ['ext-sentiment'],
        legacy: true,
      },
      compliance: {
        displayName: 'Compliance Check',
        description: 'Cực kỳ mạnh mẽ trong mảng Pháp lý. Hệ thống quét qua tài liệu dựa theo tham số criteria (VD: "Phải có chữ ký hai bên; phải có mộc đỏ"). Nếu thoả mãn trả về PASS, vi phạm trả về mảng FAIL kèm chỉ mục lỗi trong văn bản.',
        parameters: {
        criteria: PARAMS.criteria, 
        
      },
        connections: ['ext-compliance'],
      },
      'fact-check': {
        displayName: 'Fact Check',
        description: 'Kiểm chứng chéo thông tin. (Client truyền JSON dữ liệu mẫu (Sự thật) vào reference_data. Hệ thống đọc file và dò tìm xem trong tài liệu có chi tiết nào sai lệch, bịa đặt số liệu so với sự thật đó hay không).',
        parameters: {
        reference_data: PARAMS.reference_data, extract_fields: PARAMS.extract_fields, 
        
      },
        connections: ['ext-data-extractor', 'ext-fact-verifier'],
        legacy: true,
      },
      quality: {
        displayName: 'Quality Evaluation',
        description: 'Chấm điểm chất lượng văn phong (chuẩn ngữ pháp tiếng Việt, câu cú gãy gọn, logic lập luận chặt chẽ). Dùng chấm điểm bài luận hoặc duyệt lại báo cáo trước khi trình sếp.',
        parameters: {
        criteria: PARAMS.criteria
      },
        connections: ['ext-quality-eval'],
      },
      risk: {
        displayName: 'Risk Assessment',
        description: 'Đánh giá sự rủi ro. Mô hình đọc và phát hiện rủi ro (VD: điều khoản phạt quá 20% là bất hợp pháp, hoặc thiệt hại rủi ro bồi thường vô hạn trong hợp đồng).',
        parameters: {
        
      },
        connections: ['ext-quality-eval'],
      },
      'summarize-eval': {
        displayName: 'Summarize & Evaluate',
        description: 'Phân tích kép: vừa đưa ra 1 tóm lược 3-4 câu chốt tổng quát, vừa kèm đánh giá sâu của một "chuyên gia" về quan điểm của người viết bài.',
        parameters: {},
        connections: ['ext-content-gen'],
        legacy: true,
      },
    },
  },

  // ── 4. Transform ──────────────────────────────────────────────────────────
  transform: {
    slug: 'transform',
    displayName: 'Document Transformation',
    route: 'POST /api/v2/docs/transform',
    discriminatorName: 'action',
    subCases: {
      convert: {
        displayName: 'Format Convert',
        description: 'Đổi định dạng thô của file (VD: Chuyển file DOCX có nhiều định dạng phức tạp sang cấu trúc Markdown dọn dẹp sạch sẽ, hoặc HTML chuẩn web).',
        parameters: {
        output_format: PARAMS.output_format
      },
        connections: ['ext-doc-layout'],
      },
      translate: {
        displayName: 'Translation',
        description: 'Dịch thuật tài liệu nguyên bản (VD: target_language=vi). Điểm mạnh là vừa dịch vừa có thể điều chỉnh âm hưởng ngữ điệu tone (VD: dịch sang tiếng Việt cổ, hoặc giọng marketing sôi động).',
        parameters: {
        target_language: PARAMS.target_language, tone: PARAMS.tone
      },
        connections: ['ext-translator'],
      },
      rewrite: {
        displayName: 'Content Rewrite',
        description: 'Viết lại nội dung bằng câu chữ khác (Paraphrasing) nhằm tránh đạo văn, tóm gọn ý hoặc ép văn bản theo một phong cách cụ thể bằng tham số style=academic, formal, casual.',
        parameters: {
        style: PARAMS.style, tone: PARAMS.tone
      },
        connections: ['ext-rewriter'],
      },
      redact: {
        displayName: 'PII Redaction',
        description: 'Tự động dò tìm và bôi đen (ẩn đi - Masking) tự động các thông tin nhạy cảm (PII: số thẻ tín dụng, CCCD, địa chỉ cư trú, số ĐT) trên file nhằm tuân thủ luật bảo mật. Trả về file text đã được thay thế mảng đó bằng chữ [REDACTED].',
        parameters: {},
        connections: ['ext-redactor'],
      },
      template: {
        displayName: 'Template Apply',
        description: 'Cơ chế Mail Merge tự động. Client nạp một JSON data và hệ thống tự động điền các trường biến số đó vào một form/template mẫu thiết kế trước để sinh ra file final.',
        parameters: {
        template: PARAMS.template
      },
        connections: ['ext-redactor'],
      },
      split: {
        displayName: 'PDF Split',
        description: 'Tách/ghép (split/merge) các trang từ tài liệu gốc. VD: pages=1-5 để trích xuất 5 trang đầu thành PDF mới, giảm dung lượng cho các bước xử lý LLM sau đó.',
        parameters: {
        pages: PARAMS.pages
      },
        connections: ['ext-pdf-tools'],
      },
    },
  },

  // ── 5. Generate ───────────────────────────────────────────────────────────
  generate: {
    slug: 'generate',
    displayName: 'Content Generation',
    route: 'POST /api/v2/docs/generate',
    discriminatorName: 'task',
    subCases: {
      summary: {
        displayName: 'Summarize',
        description: 'Tóm tắt nội dung tài liệu với tỷ lệ nén cao, có khả năng format lại đầu ra rất phong phú: định dạng đoạn văn (paragraph), gạch đầu dòng (bullets), đánh số ưu tiên (numbered), dạng bảng (table), hoặc mô tả dưới cấu trúc sơ đồ (mind_map).',
        parameters: {},
        connections: ['ext-content-gen'],
      },
      outline: {
        displayName: 'Outline',
        description: 'Trích xuất tự động mục lục/dàn bài (Table of Contents) chuyên sâu với các đề mục phân cấp H1, H2, H3 nhằm tóm gọn nhanh cấu trúc một file PDF dài 100 trang.',
        parameters: {
        format: PARAMS.format
      },
        connections: ['ext-content-gen'],
        legacy: true,
      },
      report: {
        displayName: 'Report',
        description: 'Từ các con số thô/bảng biểu khô khan trong file, sinh ra một bài báo cáo phân tích bằng ngôn ngữ tự nhiên, được "kể lại" dưới tư duy của một chuyên gia tài chính hoặc nhân sự.',
        parameters: {},
        connections: ['ext-content-gen'],
      },
      email: {
        displayName: 'Email Draft',
        description: 'Tác vụ tuyệt vời cho Sales/CS: Trích xuất nội dung từ một yêu cầu khiếu nại của khách -> Tự động nháp (Draft) một email phản hồi xin lỗi / follow-up đúng chuẩn mực giao tiếp sự nghiệp.',
        parameters: {
        tone: PARAMS.tone
      },
        connections: ['ext-content-gen'],
      },
      minutes: {
        displayName: 'Meeting Minutes',
        description: 'Xuất nội dung biên bản cuộc họp chuyên nghiệp từ 1 file Transcript Audio nguyên bản chứa toàn các câu thoại lộn xộn, nhận diện được ai nói ý chính gì và rà soát/lập bảng Action Items (công việc cần làm tiếp theo).',
        parameters: {
        format: PARAMS.format
      },
        connections: ['ext-content-gen'],
      },
      qa: {
        displayName: 'Document QA',
        description: 'Nạp tài liệu lên bộ nhớ và cho phép hỏi đáp tức thì (tương tự như RAG) ngay trên tài liệu đó (questions=["tổng hạn mức tín dụng là bao nhiêu?", "ai có trách nhiệm đền bù khi hàng hỏng?"]).',
        parameters: {
        questions: PARAMS.questions
      },
        connections: ['ext-qa-engine'],
        legacy: true,
      },
    },
  },

  // ── 6. Compare ────────────────────────────────────────────────────────────
  compare: {
    slug: 'compare',
    displayName: 'Document Comparison',
    route: 'POST /api/v2/docs/compare',
    discriminatorName: 'mode',
    subCases: {
      verify: {
        displayName: 'Document Verification',
        description: 'Đối chiếu chứng từ với nguồn tham chiếu/hệ thống, kiểm tra chữ ký, con dấu và phát hiện sai lệch dữ liệu. Truyền reference_data (JSON sự thật) để đối soát; focus để bó hẹp vùng cần kiểm.',
        parameters: {
        reference_data: PARAMS.reference_data, focus: PARAMS.focus
      },
        connections: ['ext-comparator'],
      },
      diff: {
        displayName: 'Text Diff',
        description: 'So sánh thay đổi Text chặt chẽ từng dòng, từng ký tự (cơ chế tương tự lệnh git diff). Đánh dấu kiểm soát phiên bản tĩnh rõ ràng dòng nào được thêm [NEW], dòng nào bị xóa [DEL] chính xác đến từng dấu câu.',
        parameters: {
        output_format: PARAMS.output_format
      },
        connections: ['ext-comparator'],
      },
      semantic: {
        displayName: 'Semantic Compare',
        description: 'So sánh ngữ nghĩa (Semantic diff). Vượt qua các lỗi dính chữ hoặc sai khoảng trắng định dạng vô nghĩa. Khả năng trí tuệ tập trung tìm những khác biệt có thay đổi "về mặt ý nghĩa/pháp lý" giữa 2 bản. Đi kèm khả năng dùng tham số focus để bó hẹp chỉ quyét vùng tranh chấp (VD: "chỉ đối chiếu phần liên đới trách nhiệm hai bên").',
        parameters: {
        focus: PARAMS.focus, 
        
      },
        connections: ['ext-comparator'],
      },
      version: {
        displayName: 'Version Changelog',
        description: 'Được tối ưu chuyên biệt cho việc tạo Changelog tóm lược (Lịch sử Sửa đổi). Đọc 2 phiên bản của một tập quy định/chính sách và tự sinh ra lời tổng kết ở đầu trang: "Ở version này quy định đã Update việc thêm quyền lợi phép năm, Xóa bỏ phụ cấp thưởng ngoài".',
        parameters: {
        output_format: PARAMS.output_format
      },
        connections: ['ext-comparator'],
      },
    },
  },

  // ── 7. Workflows ──────────────────────────────────────────────────────────
  workflows: {
    slug: 'workflows',
    displayName: 'Business Workflows',
    route: 'POST /api/v2/docs/workflows',
    discriminatorName: 'process',
    subCases: {
      'disbursement': {
        displayName: 'Quy trình đối chiếu giải ngân',
        description: 'Pipeline Orchestrator xử lý từ Tách file -> Bóc tách song song -> Đối chiếu chéo -> Tờ trình.',
        parameters: {
          resolution_data: PARAMS.reference_data,
        },
        connections: [], // Orchestrator pattern uses custom code, not linear engine connections
        isWorkflow: true,
      },
      'lc-checker': {
        displayName: 'Kiểm tra Bộ Chứng từ LC',
        description: 'Kiểm tra bộ chứng từ Letter of Credit theo chuẩn quốc tế UCP 600, ISBP 821. OCR Full-text → Compliance Check (Hybrid: OCR text + PDF gốc) → LC Checking Report.',
        parameters: {},
        connections: [],
        isWorkflow: true,
      },
      'payroll-verify': {
        displayName: 'Đối chiếu Bảng lương',
        description: 'Workflow đối chiếu bảng lương PDF vs Excel: OCR → Extract → Compare rule-based. Trả về APPROVED hoặc REVIEW_REQUIRED.',
        parameters: {
          schema_mode: {
            type: 'string',
            description: 'Chế độ OCR + Compare: "minimal" (default) = 13 header + 5 record cố định + compare 13+4 (behavior hiện tại). "full" = đầy đủ fields theo Excel + numbered column mapping + compare dynamic. Switch ngay không cần deploy.',
            options: ['minimal', 'full'],
          },
          compare_config: {
            type: 'object',
            description: 'Cấu hình compare rules (header_rules, detail_rules, options). Nếu không truyền sẽ dùng default VPBank payroll config.',
          },
          pages_per_chunk: {
            type: 'number',
            description: 'Số trang PDF gộp thành 1 chunk OCR (default: 1 = mỗi trang 1 lần gọi AI). Tăng lên 2-3 nếu PDF nhiều trang muốn giảm số lần call.',
          },
          max_ocr_retries: {
            type: 'number',
            description: 'Số lần retry OCR khi quality gate fail — mismatch >30% so với Excel (default: 3). Giảm nếu muốn chạy nhanh hơn.',
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_token_url: {
            type: 'string',
            deprecated: true,
            description: 'CSP token endpoint URL (VD: https://api.aws.csp.vpbank.dev/auth/v1/csp/token). Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_client_id: {
            type: 'string',
            deprecated: true,
            description: 'CSP OAuth2 client_id cho token request. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_client_secret: {
            type: 'string',
            deprecated: true,
            description: 'CSP OAuth2 client_secret cho token request. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          ibm_client_id: {
            type: 'string',
            deprecated: true,
            description: 'APIC Gateway Client ID — gắn vào header X-IBM-Client-Id trên cả token request và file download. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
        },
        connections: [],
        isWorkflow: true,
      },
      'margin-deposit': {
        displayName: 'Xử lý Hồ sơ Ký quỹ',
        description: 'Workflow xử lý bộ hồ sơ ký quỹ, gồm 4 mode độc lập, mỗi mode gọi riêng và không phụ thuộc mode khác: ' +
          '"classify" (phân loại, không cần doc_type, cho phép nhiều chứng từ trong 1 file), ' +
          '"extraction" (bóc tách dữ liệu + chữ ký/con dấu, mỗi file = 1 chứng từ, cần doc_type), ' +
          '"framework" (đối chiếu chứng từ khách hàng với chứng từ khung theo doc_type), ' +
          '"validation" (đối chiếu N bản sao cùng doc_type/group_id bằng AI full-document diff, kèm đối chiếu khung). ' +
          'Không còn mode "e2e"; metadata.mode là bắt buộc, không có giá trị mặc định.',
        parameters: {
          metadata: {
            type: 'object',
            description:
              'JSON object điều khiển workflow. "mode" BẮT BUỘC, không có default, phải ∈ {"classify","extraction","framework","validation"}. ' +
              'Với "extraction"/"framework"/"validation": kèm "file_meta" — JSON array cùng độ dài với files[], mỗi phần tử { doc_type, role?, group_id? }. ' +
              '"role" ∈ {"customer","template"} (mặc định "customer"), chỉ có ý nghĩa với "framework"/"validation" để phân biệt chứng từ khách hàng và chứng từ khung trong CÙNG một mảng files[]. ' +
              '"group_id" bắt buộc khi role="customer" và doc_type ∈ {"thoa_thuan_ky_quy","thanh_ly_ky_quy"} trong mode "validation", dùng để nhóm các bản sao cần đối chiếu; không được DUGate tự suy luận.',
            required: true,
          },
          max_concurrency: {
            type: 'number',
            description: 'Số sub-step AI chạy đồng thời, được clamp server-side trong khoảng 1-5 (default: 3).',
            default: 3,
          },
          stagger_delay_ms: {
            type: 'number',
            hidden: true,
            description: 'Khoảng nghỉ giữa hai lần khởi chạy sub-step, clamp 0-10000ms (default: 500ms).',
            default: 500,
          },
          workflow_deadline_ms: {
            type: 'number',
            hidden: true,
            description: 'Thời gian tối đa của workflow, clamp 5000-7200000ms (default: 3600000ms).',
            default: 3600000,
          },
        },
        connections: [],
        isWorkflow: true,
      },
      'financial-report-translation': {
        displayName: 'OCR & Dịch Báo cáo tài chính nước ngoài',
        description: 'Workflow OCR + dịch BCTC nước ngoài (chuẩn Nhật, nguồn JA hoặc EN) → JSON song ngữ chuẩn hóa. ' +
          'Preflight → Classify (6 loại báo cáo) → Extract theo chunk trang → Translate (vi|en) → Merge + Validate. ' +
          'DU chỉ trả JSON; sinh Excel/Word, UI và lưu trữ thuộc hệ tích hợp (SRS §3.2).',
        parameters: {
          requestId: {
            type: 'string',
            hidden: true,
            description: 'Mã định danh request của hệ tích hợp; được echo lại trong envelope kết quả. Bỏ trống thì DU dùng operationId.',
          },
          target_lang: {
            type: 'string',
            description: 'Ngôn ngữ đích fallback cấu hình trên Profile, dùng khi request không truyền targetLang.',
            options: ['vi', 'en'],
            default: 'vi',
          },
          pages_per_chunk: {
            type: 'number',
            description: 'Số trang PDF gộp thành 1 lần gọi AI ở bước bóc tách BẢNG SỐ LIỆU (default: 2). PDF dài không bao giờ gọi AI 1 lần cho cả file.',
            default: 2,
          },
          notes_pages_per_chunk: {
            type: 'number',
            hidden: true,
            description: 'Số trang PDF gộp thành 1 lần gọi AI ở bước bóc tách THUYẾT MINH (default: 1). Thuyết minh trả toàn văn nên phản hồi dài, chunk lớn dễ bị cắt theo giới hạn token và JSON không parse được. Tăng lên chỉ khi thuyết minh ngắn.',
            default: 1,
          },
          classify_pages_per_call: {
            type: 'number',
            description: 'Số trang PDF gộp thành 1 lần gọi AI ở bước phân loại báo cáo (default: 1).',
            default: 1,
          },
          supplemental_report_title_aliases: {
            type: 'object',
            hidden: true,
            description: 'JSON object chỉ dành cho Profile để BỔ SUNG alias tiêu đề cho bước classify, ví dụ {"balanceSheet":["Custom statement title"]}. Alias lõi JA/EN luôn được giữ nguyên; không dùng cho extract hoặc Notes.',
            defaultLocked: true,
          },
          classify_recheck_unassigned: {
            type: 'boolean',
            hidden: true,
            description: 'Soi lại chỉ các dải có trang bảng chưa được classify sau lượt đầu để tránh bỏ sót báo cáo nhiều trang (default: true).',
            default: true,
          },
          classify_recheck_max_windows: {
            type: 'number',
            hidden: true,
            description: 'Số dải trang bảng chưa gán tối đa được soi lại, ưu tiên dải dài hơn để kiểm soát chi phí classify (default: 4).',
            default: 4,
          },
          extract_page_margin: {
            type: 'number',
            hidden: true,
            description: 'Số trang đệm MỖI PHÍA khi gửi trang cho bước bóc tách, bù sai số ±1 trang của classify. '
              + 'Không áp cho thuyết minh. Đặt 0 để tắt biên sau khi đã xác nhận số trang chính xác (default: 1).',
            default: 1,
          },
          classify_max_concurrency: {
            type: 'number',
            hidden: true,
            description: 'Số lần gọi AI classify đồng thời tối đa; chỉ áp dụng bước phân loại nhẹ (default: 4). Bỏ trống thì dùng max_concurrency chung để tương thích Profile cũ.',
            default: 4,
          },
          classify_stagger_delay_ms: {
            type: 'number',
            hidden: true,
            description: 'Khoảng nghỉ tối thiểu giữa các lời gọi AI classify (ms); chỉ áp dụng bước phân loại nhẹ (default: 1000). Bỏ trống thì dùng stagger_delay_ms chung để tương thích Profile cũ.',
            default: 1000,
          },
          workflow_deadline_ms: {
            type: 'number',
            description: 'Giới hạn thời gian toàn bộ workflow (ms). Quá giới hạn, operation cha chuyển FAILED thay vì trả envelope 207 từng file (default: 7200000 = 2 giờ). Phải < 9000000 (RUNNING_STALL_MS reaper) để reaper không giết oan trước deadline.',
            default: 7200000,
          },
          max_retries: {
            type: 'number',
            hidden: true,
            description: 'Số lần gọi lại AI trong CÙNG một lượt khi trả JSON không hợp lệ/timeout, cho mỗi bước classify/extract/translate (default: 3). Ngoài số này, chunk bóc tách còn được chạy lại MỘT lượt nữa sau khi mọi chunk khác đã xong (lúc backend đã rảnh) — nên không cần đặt quá cao.',
            default: 3,
          },
          max_concurrency: {
            type: 'number',
            description: 'Số lần gọi AI đồng thời tối đa (semaphore) cho cả 3 bước classify/extract/translate (default: 3). Tăng để chạy nhanh hơn, giảm nếu backend AI bị quá tải/timeout.',
            default: 3,
          },
          stagger_delay_ms: {
            type: 'number',
            description: 'Khoảng nghỉ tối thiểu giữa 2 lần khởi chạy gọi AI (ms) để tránh burst (default: 5000, theo tiền lệ payroll-verify). Không còn cộng dồn tuyến tính theo số chunk.',
            default: 5000,
          },
          extract_inter_chunk_delay_ms: {
            type: 'number',
            hidden: true,
            description: 'Khoảng nghỉ giữa các chunk tuần tự trong CÙNG một báo cáo (ms). Bỏ trống dùng stagger_delay_ms, giữ hành vi cũ; không áp cho retry pass.',
            default: 5000,
          },
          eta_seconds_per_page: {
            type: 'number',
            hidden: true,
            description: 'Số giây ước tính trên mỗi trang PDF để UI hiển thị ETA ban đầu (default: 13).',
            default: 13,
          },
          output_suppressed_report_types: {
            type: 'string',
            description: 'Danh sách CSV loại báo cáo chỉ ẩn khỏi output công khai. Bỏ trống để xuất đầy đủ gồm comprehensiveIncome; không cấu hình giữ mặc định ẩn comprehensiveIncome. Chỉ nhận ReportType hợp lệ.',
            default: 'comprehensiveIncome',
          },
          translate_batch_items: {
            type: 'number',
            hidden: true,
            description: 'Số chuỗi nguồn duy nhất tối đa trong một lô dịch (default: 40). Chuỗi trùng trong toàn file chỉ gửi AI một lần nhưng được gán lại cho mọi mục sử dụng chuỗi đó.',
            default: 40,
          },
          translate_batch_chars: {
            type: 'number',
            hidden: true,
            description: 'Tổng ký tự source tối đa trong một lô dịch (default: 20000). Một mục dài hơn giới hạn vẫn được gửi nguyên vẹn trong lô đơn lẻ.',
            default: 20000,
          },
          render_scale: {
            type: 'number',
            hidden: true,
            description: 'Chỉ áp dụng cho PDF được mã hoá (/Encrypt) — loại này phải render trang thành ảnh PNG thay vì tách trang PDF. Hệ số render, DPI hiệu dụng = 72 × scale (default: 2.5 ≈ 180 DPI). Đo trên A4: 2 → ~376KB/trang, 2.5 → ~499KB/trang, 3 → ~627KB/trang. Tăng nếu AI đọc sai chữ Nhật cỡ nhỏ trong bảng; giảm nếu upload/token quá nặng. Khoảng hợp lệ 1–4.',
            default: 2.5,
          },
          enable_translation: {
            type: 'boolean',
            description: 'Bật/tắt bước dịch. Đặt false để test riêng phần OCR + bóc bảng (output chỉ có chữ nguồn). Default true.',
            default: true,
          },
          report_types: {
            type: 'string',
            hidden: true,
            description: 'Giới hạn loại báo cáo cần bóc, phân cách bằng dấu phẩy (debug). Giá trị hợp lệ: balanceSheet, incomeStatement, cashFlowStatement, equityChangeStatement, sgaBreakdown, notesToFinancialStatements. Bỏ trống = cả 6 loại.',
            default: '',
          },
        },
        connections: [],
        isWorkflow: true,
      },
      'structure-compare': {
        displayName: 'So sánh theo Cấu trúc Ánh xạ',
        description: 'Trích xuất cấu trúc → Ghép cặp mục → Xác nhận mapping → So sánh từng cặp. Tối ưu cho tài liệu bị đổi số thứ tự, gộp/tách mục.',
        parameters: {},
        connections: [],
        isWorkflow: true,
      },
      'brd-analyze': {
        displayName: 'Phân tích & Chấm điểm BRD',
        description: 'Đọc BRD → Trích xuất trường intake → Chấm điểm AI Usecase Prioritization Scorecard (Business Value 0.6 / Technical Effort 0.3 / Reusability 0.1 + Bonus) → Final Score → Priority/Action + gợi ý cải thiện.',
        parameters: {},
        connections: [],
        isWorkflow: true,
      },
      'payment-account-management': {
        displayName: 'Quản lý tài khoản thanh toán',
        description: 'Workflow xử lý mở / đóng / phong tỏa / cập nhật tài khoản thanh toán. Feature được chọn qua metadata.mode ∈ {"open","close","freeze","update"}. ' +
          'Hỗ trợ file_urls[].total_chunks (số nguyên ≥ 1, mặc định 1) — tải file lớn theo Range trên từng file.',
        parameters: {
          metadata: {
            type: 'object',
            description:
              'JSON object điều khiển workflow. Bắt buộc field "mode" ∈ {"open","close","freeze","update"}. ' +
              'Các field khác default null; sẽ được forward nguyên trạng qua metadata.extra cho mode runner sử dụng.',
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_token_url: {
            type: 'string',
            deprecated: true,
            description: 'CSP token endpoint URL (VD: https://api.aws.csp.vpbank.dev/auth/v1/csp/token). Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_client_id: {
            type: 'string',
            deprecated: true,
            description: 'CSP OAuth2 client_id cho token request. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          csp_client_secret: {
            type: 'string',
            deprecated: true,
            description: 'CSP OAuth2 client_secret cho token request. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          /** @deprecated AUTH_MIGRATION: Dùng Profile Integration Auth. Xem workflow-engine.ts AUTH MIGRATION GUIDE. */
          ibm_client_id: {
            type: 'string',
            deprecated: true,
            description: 'APIC Gateway Client ID — gắn vào header X-IBM-Client-Id trên cả token request, file download và webhook callback. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          csp_chunk_size: {
            type: 'number',
            description: 'Kích thước mỗi chunk (bytes) khi tải file lớn theo Range (dùng với file_urls[].total_chunks > 1). Mặc định 10MB nếu không cấu hình. Admin cấu hình 1 lần trên Profile.',
            defaultLocked: true,
          },
          enable_document_splitting: {
            type: 'boolean',
            description: 'Bật tách file khi 1 file scan chứa nhiều tài liệu ghép liền (concat). ' +
              'Nếu true: bước phân loại sẽ nhận diện loại tài liệu + vị trí trang (page range) của từng ' +
              'tài liệu con, sau đó crop tách file trước khi trích xuất. Mặc định false. ' +
              'Admin cấu hình 1 lần trên Profile.',
            default: false,
            defaultLocked: true,
          },
          partner_public_key: {
            type: 'string',
            description:
              'RSA-2048 Public Key (PEM) do đối tác cung cấp. ' +
              'Khi có key, mỗi lần gửi webhook PAM sẽ tự động mã hóa payload bằng AES-256-GCM + RSA-OAEP-256.',
            multiline: true,
          },
        },
        connections: [],
        isWorkflow: true,
      },
      'statement-analyze': {
        displayName: 'Phân tích Sao kê Ngân hàng',
        description: 'Workflow OCR sao kê PDF → tính số dư → chuẩn hóa/gom đối tác → phân loại doanh thu thực → phát hiện bất thường. ' +
          'Bước enrichment dùng TypeScript + Levenshtein; revenue dùng rule engine và chỉ gọi LLM cho dòng confidence < 85; ' +
          'fraud detection chạy server-side bằng graphology/simple-statistics, trả evidence và danh sách giao dịch loại trừ. ' +
          'Artifacts enrichment, revenue_normalization và fraud_detection được thêm vào StatementAnalysisResult theo hướng tương thích ngược. ' +
          'Prompt/model cấu hình qua ProfileEndpoint với step "ocr", "revenue_adjudication", "statement_qa", "statement_risk". ' +
          'Placeholder revenue: {{transactions_json}}; Q&A/Risk: {{summary}}, {{transactions_csv}}, {{question}}.',
        parameters: {
          request_id: {
            type: 'string',
            description: 'Mã yêu cầu của bên gọi (tùy chọn) — trả lại trong kết quả để đối soát.',
          },
          pages_per_batch: {
            type: 'number',
            description: 'Số trang PDF gộp vào mỗi lần gọi model OCR (mặc định 3, tối đa 25). ' +
              'Tăng để giảm số call & nhanh hơn; giảm để giảm bỏ sót/lặp dòng & ảo giác khi sao kê nhiều giao dịch/trang.',
          },
          extra_instruction: {
            type: 'string',
            description: 'Chỉ thị bổ sung của người dùng, được GỘP vào prompt OCR mặc định khi chạy lại ' +
              '(vd: "năm của các giao dịch là 2025"). Ưu tiên tuân thủ tuyệt đối, dùng để sửa các lỗi đọc sai lặp lại.',
          },
        },
        connections: [],
        isWorkflow: true,
      },
      'tracing-portal': {
        displayName: 'Tracing Portal — Kiểm quỹ & Đối soát',
        description: 'Workflow OCR & trích xuất Biên bản kiểm quỹ CDM/ATM. Upload file BBKQ → AI phân loại + extract → JSON chuẩn gửi webhook.',
        // File URL and callback credentials are configured centrally under
        // Profile Integration Auth. Legacy params remain supported only by the
        // workflow route as a compatibility fallback for older Profiles.
        parameters: {},
        connections: [],
        isWorkflow: true,
      },
      'loan-appraisal': {
        displayName: 'Thẩm định Bộ Hồ sơ Vay',
        description: 'Loan Appraisal V2 theo state machine 5 stage: AI phân loại/bóc tách (OCR) hồ sơ → ' +
          'strategy tính tài chính → composable policy rules (rule engine + rule LLM, theo nhóm) → khuyến nghị và định tuyến review. ' +
          'Các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo, master data, kiểm tra nháp) đang TẠM TẮT ở giai đoạn 2: kết quả chỉ có OCR, chỉ số tài chính, bộ rule và khuyến nghị. ' +
          'Giữ các field AppraisalResult V1, bổ sung evidence, financial_metrics, policy_compliance, ' +
          'recommendation, review và audit có version. Các kiểm tra ngoài chưa cấu hình trả NOT_RUN. ' +
          'Step key (cấu hình prompt / model / reasoning THEO SẢN PHẨM trong loan_product_config, không còn theo Profile): ' +
          'classify ({{file_name}}, {{product_name}}, {{doc_types}}), extract ({{file_name}}, {{doc_sections}}, {{doc_keys}}), ' +
          'evaluate ({{product_name}}, {{checklist}}, {{classification}}, {{extracted_data}}), ' +
          'policy_checks ({{checks}}, {{evidence}}, {{financial}}, {{master_data}}, {{output_schema}}; model/reasoning mặc định lấy của evaluate), ' +
          'dossier_summary ({{dossier}}, {{review}}, {{output_schema}}; tổng kết tóm tắt hồ sơ, model/reasoning mặc định lấy của evaluate), ' +
          'dossier_precheck ({{checklist}}, {{documents}}, {{output_schema}}; kiểm tra sơ bộ checklist và quan hệ giữa các chứng từ ngay sau phân loại, dựa trên summary/key_facts của S1, model/reasoning mặc định lấy của evaluate), ' +
          'master_correction ({{proposals}}, {{output_schema}}; chọn giá trị đúng trong các giá trị đã đọc cho trường xung đột của master_dossier, model/reasoning mặc định lấy của evaluate), ' +
          'income_source_classify ({{sources}}, {{output_schema}}; S4 phân loại nguồn thu cho điều kiện checklist, model/reasoning mặc định lấy của evaluate), ' +
          'loan_purpose_classify ({{purposes}}, {{output_schema}}; S4 trả lời YES/NO về mục đích vay cho điều kiện checklist, model/reasoning mặc định lấy của evaluate). ' +
          'Mọi prompt luôn được thêm đoạn chống prompt injection; override thiếu placeholder dữ liệu bắt buộc sẽ được tự nối vào cuối. ' +
          'Kết quả tích hợp: GET /api/v1/operations/{id}?view=integration và /download?view=integration trả JSON ' +
          '"dugate.loan-appraisal.integration" schema_version 5.1, CHỈ kết quả cuối (case / decision / extractions (OCR) / financials / checks); parties / assets / documents / findings là tuỳ chọn và vắng khi các bước kiểm tra hồ sơ đang tắt; không có tiến trình và không có evidence; ?include=narrative,labels thêm văn bản diễn giải và nhãn; webhook SUCCEEDED gửi cùng cấu trúc này trong extracted_data. ' +
          'Với payload tích hợp, encryption_fields dạng path cụ thể không tồn tại trong cấu trúc sẽ bị từ chối (dùng "**.<field>" hoặc mode "full").',
        parameters: {
          product_code: {
            type: 'string',
            description: 'Mã sản phẩm quyết định chương trình checklist, policy version và ngưỡng deterministic. Danh sách sản phẩm cấu hình trong loan_products.json (hiện: "hkd-loan", "sme"); mã khác bị reject. Không truyền: dùng sản phẩm mặc định (default_product_code).',
          },
          flow: {
            type: 'string',
            description: 'Luồng thẩm định quyết định bộ checklist áp dụng; phải là một luồng của chương trình checklist của sản phẩm ' +
              '(checklist_programs.json; hkd-loan: "FULL" | "FAST" | "SIMPLE", tương ứng field "Flow Classification" trên IL; sme: "FLOW_A"). ' +
              'Không truyền hoặc giá trị lạ: bộ rule dùng luồng mặc định (luồng đầu) của chương trình, checklist báo INVALID_FLOW.',
          },
          stop_after_intake: {
            type: 'boolean',
            description: 'true (mặc định): dừng sau giai đoạn 1 (chỉ phân loại S1 + kiểm tra sơ bộ checklist bằng AI dossier_precheck; bóc tách OCR S2, chỉ số tài chính, bộ rule và khuyến nghị chạy ở giai đoạn 2). ' +
              'Operation chuyển WAITING_USER_INPUT (webhook PAUSED), result.extracted_data là kết quả giai đoạn 1 (result_phase = "DOSSIER_INTAKE", có dossier_precheck); ' +
              'gọi POST /api/v1/operations/{id}/resume (body {}) để chạy giai đoạn 2 từ checkpoint, không chạy lại giai đoạn 1. ' +
              'Truyền false để chạy hết 5 stage một lần như trước.',
            default: true,
          },
          intake_run_consolidate: {
            type: 'boolean',
            description: 'ĐÃ KHÔNG CÒN TÁC DỤNG (giữ khai báo để request cũ không bị từ chối): giai đoạn 2 tạm tắt các bước kiểm tra hồ sơ (S3–S5 gom người/tài sản, checklist, đối chiếu chéo, master data, kiểm tra nháp) nên không có gì để chạy sớm ở giai đoạn 1. ' +
              'Giá trị truyền vào bị bỏ qua.',
            default: false,
          },
          dossier_precheck: {
            type: 'boolean',
            description: 'true (mặc định): ngay sau phân loại (S1), LLM kiểm tra sơ bộ checklist theo danh mục hồ sơ và quan hệ giữa các chứng từ dựa trên summary/key_facts; kết quả ở dossier_precheck và, trong JSON tích hợp, ở classification.precheck (bản nháp). ' +
              'false: bỏ qua bước này (status SKIPPED). LLM lỗi hoặc trả sai định dạng thì status UNAVAILABLE, không bao giờ coi là đủ hồ sơ.',
            default: true,
          },
          intake_llm_review: {
            type: 'boolean',
            description: 'true (mặc định): bước kiểm tra nháp cho Sale dùng LLM viết tổng kết tóm tắt hồ sơ (step key dossier_summary, chạy ở giai đoạn 2 ngay sau S2). ' +
              '4 tiêu chí tiếp nhận do quy tắc dựng từ kết quả kiểm tra sơ bộ (dossier_precheck) nên KHÔNG gọi thêm LLM để chấm lại tiêu chí. ' +
              'false: chỉ dùng tổng kết bằng quy tắc, không gọi LLM. LLM lỗi hoặc trả sai định dạng thì tự dùng tổng kết bằng quy tắc.',
            default: true,
          },
          master_correction: {
            type: 'boolean',
            description: 'true (mặc định): sau khi dựng master_dossier (cùng lúc với S3–S5: giai đoạn 2, hoặc giai đoạn 1 nếu intake_run_consolidate = true), một lần gọi LLM (step key master_correction) chọn giá trị đúng trong các giá trị đã đọc ' +
              'cho trường định danh / tên / ngày bị xung đột khi đủ căn cứ (đa số tuyệt đối từ ≥ 2 chứng từ, lệch 1–2 ký tự, các bản lệch chỉ ở một loại tài liệu). ' +
              'Trường được chọn có status = CORRECTED, review_status = REVIEW, vẫn giữ các giá trị đã đọc ở candidates. LLM chỉ chọn, không tạo giá trị mới. ' +
              'false: không gọi LLM, trường giữ CONFLICT. LLM lỗi hoặc trả sai định dạng thì không hiệu chỉnh trường nào.',
            default: true,
          },
          acknowledgements: {
            type: 'string',
            description: 'Giải trình cho các điểm của intake_assessment khi chạy lại hồ sơ: JSON [{ "finding_code": "...", "reason": "..." }] ' +
              '(tối đa 200 mục, lý do ≤ 500 ký tự). Mã lấy từ intake_assessment.criteria[].findings[].code của lần chạy trước; thiếu chứng từ bắt buộc không giải trình được.',
          },
          lac_mode: {
            type: 'string',
            description: 'Loan Application Context (D-103) cho rule LLM (stage 3): "off" (mặc định) chạy như cũ; ' +
              '"shadow" dựng ngữ cảnh đơn vay chỉ để thống kê (loan_application_context_summary, content_preview.lac), không đổi prompt; ' +
              '"on" prompt rule LLM dùng {{context}} (dữ kiện mã F<n> có trạng thái tin cậy, mâu thuẫn, khoảng trống) thay cho {{master_data}} + {{evidence}}, ' +
              'kèm rào hạ PASS khi dữ kiện bị tranh chấp hoặc chỉ dựa trên lời khai (allow_declared_pass của từng rule). ' +
              'Dựng ngữ cảnh lỗi thì tự chạy đường cũ và ghi cảnh báo. Giá trị khác coi như "off".',
            options: ['off', 'shadow', 'on'],
            default: 'off',
          },
          loan_product_config: {
            type: 'object',
            description: 'Cấu hình workflow THEO SẢN PHẨM: { version, products: { <product_code>: { prompts, models, reasoning, policy, checks, checklist, flows } } }. ' +
              'prompts / models / reasoning là map step key → giá trị (step key: xem danh sách trên; classify, extract, evaluate chỉ có model / reasoning). ' +
              'policy: ngưỡng minimum_dscr, maximum_ltv, maximum_amount_vnd, default_tenor_months. checks: bộ rule { program, version, checks[] }. ' +
              'checklist: override mức yêu cầu { item_key: { FLOW: REQUIRED | CONDITIONAL | NOT_REQUIRED | null } } theo chương trình của sản phẩm. ' +
              'flows[<FLOW>].checks: bật/tắt rule theo luồng { rule_id: boolean }. ' +
              'Quản trị qua trang /loan-appraisal-v2/config; cấu hình sai bị từ chối khi lưu, lúc chạy mục sai bị bỏ và ghi cảnh báo. Admin khoá, client không gửi được.',
            defaultLocked: true,
            hidden: true,
          },        },
        connections: [],
        isWorkflow: true,
      },
      'account-opening': {
        displayName: 'Tiếp nhận & Đánh giá Hồ sơ Mở Tài khoản',
        description: 'Account Opening V1 theo state machine 8 stage: AI phân loại/bóc tách/hợp nhất Customer Profile → ' +
          'strategy chấm điều kiện mở tài khoản và rà soát khách hàng (CDD R1-R5) → rule engine + rule LLM theo PHÂN KHÚC ' +
          '(KHCN/HKD/SME/KHDN) và SẢN PHẨM → ranh giới sàng lọc → kết luận và định tuyến rà soát. ' +
          'Kết quả gồm checklist, evidence, eligibility_metrics, cdd_assessment, policy_compliance, recommendation, review và audit có version. ' +
          'Sàng lọc AML/PEP/sanctions/CIF chưa cấu hình provider nên trả NOT_RUN; quyền quyết định mở tài khoản thuộc hệ thống onboarding.',
        parameters: {
          segment: {
            type: 'string',
            description: 'Phân khúc khách hàng quyết định checklist và bộ rule: "KHCN" | "HKD" | "SME" | "KHDN". ' +
              'Truyền một mình thì dùng sản phẩm mặc định của phân khúc; giá trị khác bị reject.',
          },
          product_code: {
            type: 'string',
            description: 'Mã sản phẩm tài khoản quyết định checklist, ngưỡng policy và phạm vi rule. Hỗ trợ ' +
              '"casa-khcn-standard", "casa-khcn-nonresident", "casa-hkd-standard", "casa-sme-standard", "casa-khdn-standard". ' +
              'Nếu truyền cùng segment thì hai giá trị phải khớp phân khúc, ngược lại bị reject.',
          },
        },
        connections: [],
        isWorkflow: true,
      },
    },
  },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

// `return_bbox` is a cross-cutting option for EVERY extract sub-case. Injected here
// (instead of repeating on each sub-case) so it shows up in discovery/docs and is
// accepted by mergeParameters in the runner.
for (const sub of Object.values(SERVICE_REGISTRY.extract.subCases)) {
  sub.parameters = { ...sub.parameters, return_bbox: PARAMS.return_bbox };
}

// Response/webhook encryption is a cross-cutting, per-Profile opt-in for EVERY
// endpoint (core API + workflow). Auto-injecting ENCRYPTION_PARAMS here — instead of
// spreading it onto each sub-case by hand — guarantees:
//   1. every existing endpoint exposes the encryption_enabled toggle + sub-params,
//   2. any NEW endpoint automatically inherits it (no one has to remember to add it).
// The sub-params carry `hidden`+`showWhen`, so the Profile UI only reveals them once
// `encryption_enabled` is turned on for that endpoint in that Profile.
//
// PAM is included in the schema injection so its Profile is ready for the future
// encryption flow. Its runtime remains legacy by default: the PAM workflow explicitly
// owns the `partner_public_key` / pam-legacy transform, and existing Profiles do not
// have `encryption_enabled=true`. Do not enable the new toggle for PAM until its
// receiver is migrated to the spec wire format.
// Only fills gaps (spread first) so any endpoint that already defines one of these
// keys keeps its own definition.
for (const [, svc] of Object.entries(SERVICE_REGISTRY)) {
  for (const [, sub] of Object.entries(svc.subCases)) {
    sub.parameters = { ...ENCRYPTION_PARAMS, ...sub.parameters };
  }
}

export function getAllEndpointSlugs() {
  return Object.entries(SERVICE_REGISTRY).flatMap(([svcSlug, svc]) =>
    Object.entries(svc.subCases).map(([caseKey, sub]) => ({
      slug: caseKey === '_default' ? svcSlug : `${svcSlug}:${caseKey}`,
      displayName: sub.displayName,
      serviceName: svc.displayName,
      serviceSlug: svcSlug,
      deprecated: svc.deprecated ?? false,
      route: svc.route,
      discriminatorName: svc.discriminatorName,
      discriminatorValue: caseKey !== '_default' ? caseKey : null,
      description: sub.description,
      connections: sub.connections,
      isWorkflow: sub.isWorkflow ?? false,
      // Map back to arrays for backward compatibility or return schemas directly
      parameters: Object.keys(sub.parameters),
      parametersSchema: sub.parameters,
      allowedExtensions: resolveAllowedExtensions(`${svcSlug}${caseKey !== '_default' ? `:${caseKey}` : ''}`),
    }))
  );
}

// ─── Per-endpoint allowed file extensions ──────────────────────────────────────
// Declares, per endpoint, exactly which file types are accepted by default.
// This is the SELF-DOCUMENTING source of truth that replaces the misleading
// "global default = doc + pdf" assumption.
//
// Rationale:
// - PDF + images: AI-native, readable by EVERY connector mode (multipart & AIHub).
// - DOCX/XLSX: only parseable LOCALLY via internal Word/Excel parsers (multipart mode).
//   AIHub/vision connectors CANNOT read Office binaries, so these are opt-in only on
//   endpoints whose default connector parses them internally.
//
// Priority at runtime: Profile.allowedFileExtensions > this map > global DEFAULT_ALLOWED_EXTENSIONS.
//
// ZERO-REGRESSION RULE: the previous global default was ['.docx', '.pdf'], so EVERY
// endpoint historically accepted DOCX+PDF. To avoid breaking units already in
// production, every policy below is a SUPERSET of {pdf, docx} — we only ADD images
// (and sheets where relevant). Nothing that validated before will now be rejected.
// (Whether a connector can actually READ docx depends on its mode — that is unchanged
//  by this map and was always the case.)

const EXT_DOC: readonly string[] = [...PDF_EXTENSIONS, ...WORD_EXTENSIONS, ...IMAGE_EXTENSIONS];
const EXT_DOC_SHEET: readonly string[] = [...PDF_EXTENSIONS, ...WORD_EXTENSIONS, ...SHEET_EXTENSIONS, ...IMAGE_EXTENSIONS];

export const ENDPOINT_ALLOWED_EXTENSIONS: Record<string, readonly string[]> = {
  // ingest
  'ingest:parse':    EXT_DOC,
  'ingest:ocr':      EXT_DOC,
  'ingest:digitize': EXT_DOC,
  'ingest:split':    EXT_DOC,

  // extract — forms & docs
  'extract:disbursement':    EXT_DOC,
  'extract:guarantee':       EXT_DOC,
  'extract:approval':        EXT_DOC,
  'extract:collateral':      EXT_DOC,
  'extract:credit-report':   EXT_DOC_SHEET,
  'extract:payment-order':   EXT_DOC,
  'extract:lc':              EXT_DOC,
  'extract:business-license':EXT_DOC,
  'extract:account-form':    EXT_DOC,
  'extract:civil-doc':       EXT_DOC,
  'extract:vehicle-doc':     EXT_DOC,
  'extract:insurance':       EXT_DOC,
  'extract:invoice':  EXT_DOC,
  'extract:contract': EXT_DOC,
  'extract:id-card':  EXT_DOC,
  'extract:receipt':  EXT_DOC,
  'extract:custom':   EXT_DOC_SHEET,

  // analyze
  'analyze:classify':        EXT_DOC,
  'analyze:sentiment':       EXT_DOC,
  'analyze:compliance':      EXT_DOC,
  'analyze:fact-check':      EXT_DOC,
  'analyze:quality':         EXT_DOC,
  'analyze:risk':            EXT_DOC,
  'analyze:summarize-eval':  EXT_DOC,

  // transform
  'transform:convert':   EXT_DOC,
  'transform:translate': EXT_DOC,
  'transform:rewrite':   EXT_DOC,
  'transform:redact':    EXT_DOC,
  'transform:template':  EXT_DOC,
  'transform:split':     EXT_DOC,

  // generate
  'generate:summary': EXT_DOC,
  'generate:outline': EXT_DOC,
  'generate:report':  EXT_DOC,
  'generate:email':   EXT_DOC,
  'generate:minutes': EXT_DOC,
  'generate:qa':      EXT_DOC,

  // compare
  'compare:verify':   EXT_DOC,
  'compare:diff':     EXT_DOC,
  'compare:semantic': EXT_DOC,
  'compare:version':  EXT_DOC,

  // workflows (orchestrators)
  'workflows:disbursement':      EXT_DOC,
  'workflows:lc-checker':        EXT_DOC,
  'workflows:payroll-verify':    EXT_DOC_SHEET,
  'workflows:structure-compare': EXT_DOC,
  // BCTC nước ngoài: input chỉ PDF (SRS §3.2 — định dạng khác PDF nằm ngoài phạm vi).
  'workflows:financial-report-translation': PDF_EXTENSIONS,
  // PAM (open/update/...) reads only scanned forms + ID images — PDF + image only.
  'workflows:payment-account-management': [...PDF_EXTENSIONS, ...IMAGE_EXTENSIONS],
  // Statement analyze reads bank statement PDFs only.
  'workflows:statement-analyze': [...PDF_EXTENSIONS],
  // Loan appraisal ingests a whole loan dossier: PDF + images + Office docs.
  'workflows:loan-appraisal': EXT_DOC_SHEET,
  // Account opening ingests a whole onboarding dossier: scanned forms, ID images,
  // legal documents — same breadth as a loan dossier.
  'workflows:account-opening': EXT_DOC_SHEET,
};

/**
 * Resolve the registry-level allowed extensions for an endpoint slug
 * (e.g. "extract:invoice" or service-level "extract"). Returns a comma-separated
 * string (matching the Profile.allowedFileExtensions format) or undefined if the
 * endpoint has no specific policy (caller falls back to global DEFAULT_ALLOWED_EXTENSIONS).
 */
export function resolveAllowedExtensions(endpointSlug: string): string | undefined {
  const exts = ENDPOINT_ALLOWED_EXTENSIONS[endpointSlug];
  return exts ? exts.join(',') : undefined;
}
