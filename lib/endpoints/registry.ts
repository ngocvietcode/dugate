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
  /** Whether this parameter defaults to being locked (profile-only) */
  defaultLocked?: boolean;
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
    route: 'POST /api/v1/docs/ingest',
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
    route: 'POST /api/v1/docs/extract',
    discriminatorName: 'type',
    subCases: {
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
      },
      table: {
        displayName: 'Table Extractor',
        description: 'Dò tìm và bóc tách TẤT CẢ các bảng biểu có trong file PDF thành list mảng 2 chiều JSON hoặc định dạng CSV, loại bỏ đi các phần text văn xuôi thừa.',
        parameters: {
        
      },
        connections: ['ext-data-extractor'],
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
    route: 'POST /api/v1/docs/analyze',
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
      },
    },
  },

  // ── 4. Transform ──────────────────────────────────────────────────────────
  transform: {
    slug: 'transform',
    displayName: 'Document Transformation',
    route: 'POST /api/v1/docs/transform',
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
        parameters: {},
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
    },
  },

  // ── 5. Generate ───────────────────────────────────────────────────────────
  generate: {
    slug: 'generate',
    displayName: 'Content Generation',
    route: 'POST /api/v1/docs/generate',
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
      },
    },
  },

  // ── 6. Compare ────────────────────────────────────────────────────────────
  compare: {
    slug: 'compare',
    displayName: 'Document Comparison',
    route: 'POST /api/v1/docs/compare',
    discriminatorName: 'mode',
    subCases: {
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
    route: 'POST /api/v1/docs/workflows',
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
        description: 'Kiểm tra bộ chứng từ Letter of Credit theo chuẩn quốc tế UCP 600, ISBP 821. Classify → OCR → HITL → Compliance Check → LC Checking Report.',
        parameters: {},
        connections: [],
        isWorkflow: true,
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
      route: svc.route,
      discriminatorName: svc.discriminatorName,
      discriminatorValue: caseKey !== '_default' ? caseKey : null,
      description: sub.description,
      connections: sub.connections,
      isWorkflow: sub.isWorkflow ?? false,
      // Map back to arrays for backward compatibility or return schemas directly
      parameters: Object.keys(sub.parameters),
      parametersSchema: sub.parameters,
    }))
  );
}
