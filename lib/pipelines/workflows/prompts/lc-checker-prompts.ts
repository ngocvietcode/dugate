// lib/pipelines/workflows/prompts/lc-checker-prompts.ts
// Prompt builders for the LC Document Checker workflow.
//
// Each function returns { _prompt: "complete prompt text" }.
// The _prompt variable bypasses the DB connector template entirely.
// Connector still provides: API URL, auth, model, timeout, response parsing.
//
// Compliance check (Step 3) is SELF-CONTAINED — all UCP 600 / ISBP 821 rules
// are embedded directly into the prompt. No external reference data needed.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogicalDocument {
  id: string;
  label: string;
  pages: string;
  confidence: number;
  source_file: string;
}

export interface ClassifyData {
  document_type?: string;
  confidence?: number;
  logical_documents?: LogicalDocument[];
}

export interface ClassifyFileResult {
  fileName: string;
  classifyData: ClassifyData;
  logicalDocs: LogicalDocument[];
  subOperationId: string;
  status: 'success';
}

export interface ClassifyFileError {
  fileName: string;
  classifyData: Record<string, never>;
  logicalDocs: never[];
  subOperationId: string;
  status: 'error';
  error: string;
}

export type ClassifyResult = ClassifyFileResult | ClassifyFileError;

export interface MergedClassifyData {
  files_analyzed: number;
  total_logical_documents: number;
  per_file: Array<{
    file: string;
    document_type: string | undefined;
    logical_documents_count: number;
  }>;
  logical_documents: LogicalDocument[];
}

export interface ExtractFileResult {
  file_name: string;
  logical_docs: string[];
  status: 'success';
  sub_operation_id: string;
  content: any;
  extracted_data: unknown;
}

export interface ExtractFileError {
  file_name: string;
  logical_docs: string[];
  status: 'error';
  error: string;
}

export type ExtractResult = ExtractFileResult | ExtractFileError;

export interface LCDiscrepancy {
  id: string;
  severity: 'MAJOR' | 'MINOR' | 'ADVISORY';
  document: string;
  field: string;
  issue: string;
  rule_reference: string;
  recommendation: string;
}

export interface LCCheckResult {
  verdict: 'COMPLIANT' | 'DISCREPANT' | 'PENDING';
  total_discrepancies: number;
  major_discrepancies: number;
  minor_discrepancies: number;
  advisory_count: number;
  documents_present: string[];
  documents_missing: string[];
  discrepancies: LCDiscrepancy[];
  summary: string;
  recommendation: 'ACCEPT' | 'REJECT' | 'RESERVE_FOR_REVIEW';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LC_DOCUMENT_CATEGORIES = [
  'Letter of Credit',
  'Bill of Lading',
  'Commercial Invoice',
  'Packing List',
  'Bill of Exchange',
  'Certificate of Origin',
  'Insurance Certificate',
  'Inspection Certificate',
  'Phytosanitary Certificate',
  'Customs Declaration',
  'Airway Bill',
  'Draft',
  'Khác',
] as const;

/** Map LC document label → extraction fields */
const LC_EXTRACT_FIELD_MAP: Record<string, string> = {
  'Letter of Credit': [
    'Số L/C (LC Number)', 'Ngày mở L/C (Issue Date)', 'Ngày hết hạn (Expiry Date)',
    'Địa điểm hết hạn (Expiry Place)', 'Ngân hàng phát hành (Issuing Bank)',
    'Ngân hàng thụ hưởng (Beneficiary Bank)', 'Người thụ hưởng (Beneficiary)',
    'Người yêu cầu (Applicant)', 'Số tiền L/C (LC Amount)', 'Loại tiền tệ (Currency)',
    'Điều kiện giao hàng (Incoterms)', 'Cảng bốc (Port of Loading)',
    'Cảng đích (Port of Discharge)', 'Hàng hóa mô tả (Goods Description)',
    'Hạn chót giao hàng (Latest Shipment Date)',
    'Loại L/C (Irrevocable/Revocable, Confirmed/Unconfirmed, Transferable)',
    'Điều kiện thanh toán (Payment Terms)', 'Chứng từ yêu cầu (Required Documents)',
  ].join(', '),

  'Bill of Lading': [
    'Số B/L (B/L Number)', 'Ngày phát hành (Issue Date)', 'Ngày bốc hàng (On Board Date)',
    'Người gửi hàng (Shipper)', 'Người nhận hàng (Consignee)',
    'Thông báo (Notify Party)', 'Cảng bốc (Port of Loading)',
    'Cảng dỡ (Port of Discharge)', 'Mô tả hàng hóa (Goods Description)',
    'Số container/Marks (Container/Marks)', 'Tên tàu (Vessel Name)',
    'Voyage', 'Số bản gốc phát hành (Number of Originals)',
    'Freight (Prepaid/Collect)', 'Ghi chú (Clauses/Remarks)',
    'Loại vận đơn (On Board/Received for Shipment)',
  ].join(', '),

  'Commercial Invoice': [
    'Số Invoice (Invoice Number)', 'Ngày (Invoice Date)',
    'Người xuất khẩu/Người bán (Exporter/Seller)',
    'Người nhập khẩu/Người mua (Importer/Buyer)',
    'Số L/C tham chiếu (LC Reference)', 'Điều kiện giao hàng (Incoterms)',
    'Mô tả hàng hóa (Goods Description)', 'Số lượng (Quantity)',
    'Đơn giá (Unit Price)', 'Loại tiền tệ (Currency)',
    'Tổng giá trị (Total Amount)', 'Thuế (Tax/VAT if any)',
    'Cảng bốc (Port of Loading)', 'Cảng đích (Port of Destination)',
    'Ký hiệu và số hiệu (Marks and Numbers)',
  ].join(', '),

  'Packing List': [
    'Số Packing List', 'Ngày (Date)', 'Người xuất khẩu (Exporter)',
    'Người mua (Buyer)', 'Số Invoice tham chiếu (Invoice Reference)',
    'Mô tả hàng hóa (Goods Description)', 'Số kiện (Number of Packages)',
    'Loại bao bì (Package Type)', 'Trọng lượng cả bì (Gross Weight)',
    'Trọng lượng tịnh (Net Weight)', 'Thể tích (Volume/CBM)',
    'Ký hiệu và số hiệu (Marks and Numbers)',
  ].join(', '),

  'Bill of Exchange': [
    'Số hối phiếu (Draft Number)', 'Ngày ký phát (Issue Date)',
    'Người ký phát (Drawer)', 'Người trả tiền (Drawee)',
    'Số tiền (Amount)', 'Loại tiền tệ (Currency)',
    'Kỳ hạn thanh toán (Tenor/Usance)',
    'Số L/C tham chiếu (LC Reference)',
    'Điều kiện thanh toán (At sight / Usance)',
  ].join(', '),

  'Certificate of Origin': [
    'Số chứng nhận (Certificate Number)', 'Ngày cấp (Date of Issue)',
    'Cơ quan cấp (Issuing Authority)', 'Nước xuất xứ (Country of Origin)',
    'Người xuất khẩu (Exporter)', 'Người nhập khẩu (Importer)',
    'Mô tả hàng hóa (Goods Description)', 'Số lượng (Quantity)',
    'Trọng lượng (Weight)', 'Tiêu chí xuất xứ (Origin Criterion)',
    'Số Invoice tham chiếu (Invoice Reference)',
  ].join(', '),

  'Insurance Certificate': [
    'Số chứng nhận bảo hiểm (Policy/Certificate Number)',
    'Ngày phát hành (Issue Date)', 'Người được bảo hiểm (Insured)',
    'Người thụ hưởng (Beneficiary)', 'Hàng hóa được bảo hiểm (Goods Insured)',
    'Số tiền bảo hiểm (Insured Amount)', 'Loại tiền tệ (Currency)',
    'Rủi ro được bảo hiểm (Risks Covered)',
    'Hành trình (Voyage: From → To)',
    'Tên tàu/Phương tiện (Vessel/Conveyance)',
    'Điều kiện bảo hiểm (ICC Clause: A/B/C)',
  ].join(', '),

  'Inspection Certificate': [
    'Số chứng nhận kiểm tra (Certificate Number)', 'Ngày kiểm tra (Inspection Date)',
    'Cơ quan kiểm tra (Inspection Authority)', 'Hàng hóa (Goods Description)',
    'Số lượng (Quantity)', 'Kết quả kiểm tra (Inspection Result)',
  ].join(', '),
};

const DEFAULT_LC_EXTRACT_FIELDS = 'Số hiệu chứng từ, Ngày phát hành, Các bên liên quan, Giá trị, Mô tả hàng hóa, Ghi chú đặc biệt';

// ─── Step 1: Classify ─────────────────────────────────────────────────────────

export function buildClassifyPrompt(
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        categories: LC_DOCUMENT_CATEGORIES.join(', '),
      }),
    };
  }

  return {
    _prompt: `You are an expert in international trade finance and documentary credits (LC).
Task: identify and classify ALL document types present in the file "${fileName}".

For EACH logical document detected, return:
- id: unique key, e.g. "ld-1", "ld-2"
- label: EXACT name from the allowed categories below
- pages: page range, e.g. "1-3", "4", "all"
- confidence: 0.0–1.0

ALLOWED CATEGORIES (use EXACTLY these labels):
${LC_DOCUMENT_CATEGORIES.join('\n')}

CLASSIFICATION RULES:
- "Letter of Credit" = the L/C instrument itself (MT700, L/C form, Swift)
- "Bill of Lading" = ocean B/L; use "Airway Bill" for air transport AWB
- "Bill of Exchange" and "Draft" are both hối phiếu — use "Bill of Exchange"
- A single PDF may contain MULTIPLE document types on different pages — list each separately
- Use "Khác" only if no category matches
- Do NOT merge separate documents into one entry

Return ONLY valid JSON (no markdown fences):
{
  "document_type": "Primary document type in this file",
  "confidence": 0.95,
  "logical_documents": [
    { "id": "ld-1", "label": "Commercial Invoice", "pages": "1-2", "confidence": 0.97 },
    { "id": "ld-2", "label": "Packing List", "pages": "3", "confidence": 0.95 }
  ]
}`,
  };
}

export function parseClassifyResult(
  content: string | null,
  sourceFileName: string,
): { classifyData: ClassifyData; logicalDocs: LogicalDocument[] } {
  let classifyData: ClassifyData = {};

  if (content) {
    try {
      let cleanContent = content.trim();
      const match = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match && match[1]) {
        cleanContent = match[1].trim();
      }
      classifyData = JSON.parse(cleanContent) as ClassifyData;
    } catch (err) {
      console.warn(`[parseClassifyResult] Failed to parse JSON for ${sourceFileName}:`, err);
      console.warn(`RAW CONTENT:`, content);
      classifyData = {};
    }
  }

  const rawDocs = classifyData.logical_documents ?? [];

  const logicalDocs: LogicalDocument[] = rawDocs.length > 0
    ? rawDocs.map((doc) => ({
        ...doc,
        source_file: doc.source_file || sourceFileName,
      }))
    : [{
        id: `auto-${sourceFileName.replace(/\W/g, '_')}`,
        label: classifyData.document_type || 'Chứng từ LC',
        pages: 'all',
        confidence: classifyData.confidence || 1.0,
        source_file: sourceFileName,
      }];

  return { classifyData, logicalDocs };
}

export function mergeClassifyResults(
  results: ClassifyFileResult[],
): { allLogicalDocs: LogicalDocument[]; mergedClassifyData: MergedClassifyData } {
  const allLogicalDocs = results.flatMap(r => r.logicalDocs);
  const mergedClassifyData: MergedClassifyData = {
    files_analyzed: results.length,
    total_logical_documents: allLogicalDocs.length,
    per_file: results.map(r => ({
      file: r.fileName,
      document_type: r.classifyData.document_type,
      logical_documents_count: r.logicalDocs.length,
    })),
    logical_documents: allLogicalDocs,
  };
  return { allLogicalDocs, mergedClassifyData };
}

// ─── Step 2: Extract ──────────────────────────────────────────────────────────

export function buildExtractPrompt(
  docsInFile: LogicalDocument[],
  fileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  const docSections = docsInFile.map((doc) => {
    const fields = LC_EXTRACT_FIELD_MAP[doc.label] || DEFAULT_LC_EXTRACT_FIELDS;
    return `- "${doc.label}" (pages ${doc.pages}): extract [${fields}]`;
  }).join('\n');

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        file_name: fileName,
        doc_sections: docSections,
      }),
    };
  }

  return {
    _prompt: `You are an expert LC document examiner. Extract all required fields from file "${fileName}".

This file contains ${docsInFile.length} document(s):
${docSections}

EXTRACTION RULES:
1. Copy field values EXACTLY as they appear — do NOT translate, summarize, or interpret
2. Preserve original formatting: dates (e.g. 15 Apr 2025), amounts (e.g. USD 50,000.00), reference numbers
3. If a field is not found → use null (not empty string)
4. For descriptions and remarks: copy the FULL TEXT verbatim, do not truncate
5. Capture any CLAUSES, ENDORSEMENTS, or SPECIAL CONDITIONS in the "special_conditions" array
6. For Bill of Lading specifically:
   - Record if it states "CLEAN ON BOARD" or has any remarks about goods/packaging condition
   - Record the exact on-board date notation (e.g. "Shipped on board 10 Apr 2025")
   - Record freight payment terms exactly (Freight Prepaid / Freight Collect)

Return ONLY valid JSON (no markdown fences):
{
  "file": "${fileName}",
  "documents": [
    {
      "label": "Exact document type label",
      "pages": "page range",
      "fields": {
        "Field Name": "Exact value from document",
        "Another Field": null
      },
      "special_conditions": ["Any clause, endorsement, or special note found verbatim"]
    }
  ]
}`,
  };
}

// ─── Step 3: Compliance Check (UCP 600 / ISBP 821 — Self-contained) ──────────

export function buildComplianceCheckPrompt(
  extractionResults: ExtractResult[],
  promptOverride?: string,
): Record<string, unknown> {
  const successResults = extractionResults.filter(
    (r): r is ExtractFileResult => r.status === 'success',
  );

  const extractionSummary = successResults.map(r =>
    `File "${r.file_name}": ${r.logical_docs?.join(', ') || 'N/A'}`
  ).join('\n');

  const extractionDetail = JSON.stringify(
    successResults.map(r => ({ file: r.file_name, data: r.extracted_data })), null, 2,
  );

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        extraction_summary: extractionSummary,
        extraction_detail: extractionDetail,
      }),
    };
  }

  return {
    _prompt: `You are a senior Documentary Credit (LC) checker with expertise in UCP 600, ISBP 821 (2013 Revision) and eUCP v2.0.

TASK: Examine the presented LC document set for compliance with international standards and internal cross-document consistency.
You do NOT need the original L/C — apply the rules below as your embedded expert knowledge base.

=== EXTRACTED DOCUMENT DATA ===
Files presented (${successResults.length}):
${extractionSummary}

Full extraction detail:
${extractionDetail}

=== EXAMINATION RULES (UCP 600 / ISBP 821) ===

GROUP A — DOCUMENT COMPLETENESS [UCP 600 Art. 14]
A1. List all document types identified in the presented set -> populate "documents_present"
A2. Flag as ADVISORY if any of these are absent:
    - Commercial Invoice (ALWAYS required)
    - Bill of Lading or Airway Bill (required if shipment is involved)
A3. If Insurance Certificate, Certificate of Origin, or Bill of Exchange exist but appear
    incomplete, flag as MINOR

GROUP B — COMMERCIAL INVOICE [UCP 600 Art. 18 / ISBP 821 Section C]
B1. [MAJOR] Goods description: must be specific and unambiguous [ISBP 821 C1]
B2. [MINOR] Seller and Buyer names/addresses: must be clearly stated
B3. [MAJOR] Currency: must be consistent throughout the invoice
B4. [MAJOR] Amount: must be a positive number in correct format
B5. [MINOR] If LC reference number appears: must be consistent with other documents
B6. [MINOR] Incoterms: if stated, must be a valid ICC Incoterm (EXW/FOB/CFR/CIF/DAP)

GROUP C — BILL OF LADING [UCP 600 Art. 20 / ISBP 821 Section E]
C1. [MAJOR] On board notation: must show a specific on-board date [Art. 20(a)(ii)]
C2. [MAJOR] Port of Loading: must be explicitly stated
C3. [MAJOR] Port of Discharge: must be explicitly stated
C4. [MAJOR] Consignee: must be "To Order", "To Order of [bank name]", or a named party — NOT blank
C5. [MAJOR] Cleanliness: B/L MUST NOT contain any clause declaring defective condition
    of goods or packaging — this triggers UCP 600 Art. 27 (Unclean B/L)
C6. [MINOR] Number of originals issued must be stated (e.g. "3/3 ORIGINALS")
C7. [MINOR] Freight terms: Prepaid or Collect must be indicated clearly
C8. [ADVISORY] Vessel name and voyage number should be present

GROUP D — CROSS-DOCUMENT CONSISTENCY [UCP 600 Art. 14d / ISBP 821 A18]
D1. [MAJOR] Goods description must NOT contradict between:
    Invoice <-> Packing List <-> Bill of Lading <-> Certificate of Origin
    (different wording is acceptable; outright contradiction is not)
D2. [MINOR] Quantity must be consistent across documents (+-5% tolerance if applicable)
D3. [MINOR] Gross/net weight: Packing List and B/L must not contradict each other
D4. [MAJOR] Date logic: Invoice date must NOT be later than B/L on-board date
    (goods must be invoiced before or on the date of shipment)
D5. [MINOR] LC reference number, if on multiple documents, must match exactly
D6. [MINOR] Goods name must not conflict between any two documents

GROUP E — ANCILLARY DOCUMENTS
E1. Certificate of Origin [ISBP 821 Section L]
    [MINOR] Country of origin explicitly stated
    [MINOR] Issuing authority named
    [MINOR] Goods description must not contradict Invoice
E2. Insurance Certificate / Policy [UCP 600 Art. 28]
    [MAJOR] Insured amount >= 110% of CIF invoice value [Art. 28(f)(ii)]
    [MAJOR] Effective date must not be later than B/L on-board date [Art. 28(e)]
    [MINOR] Risks covered: at minimum ICC(A) or all-risks equivalent
E3. Bill of Exchange / Draft
    [MAJOR] Amount must match Commercial Invoice amount exactly
    [MINOR] Drawee must be identified (issuing/nominated bank or buyer)
    [MINOR] Tenor/usance must be clearly stated ("at sight", "60 days after B/L date", etc.)
E4. Inspection / Phytosanitary Certificate
    [MINOR] Issue date must not be later than the B/L on-board date

=== SEVERITY DEFINITIONS ===
- MAJOR    -> must cause refusal under UCP 600 Art. 16 unless applicant waives
- MINOR    -> formal issue; may be acceptable or requires clarification at examiner's discretion
- ADVISORY -> observation or absent optional element; no automatic refusal

verdict logic:
- "COMPLIANT"  -> zero MAJOR + zero MINOR discrepancies
- "DISCREPANT" -> at least one MAJOR or MINOR discrepancy
- "PENDING"    -> data insufficient to determine (e.g. key document missing entirely)

recommendation logic:
- "ACCEPT"             -> COMPLIANT, all checks pass
- "REJECT"             -> one or more MAJOR discrepancies that cannot be waived
- "RESERVE_FOR_REVIEW" -> MINOR discrepancies only, or mixed with ADVISORY

=== OUTPUT ===
Return ONLY valid JSON (no markdown fences):
{
  "verdict": "COMPLIANT | DISCREPANT | PENDING",
  "total_discrepancies": 0,
  "major_discrepancies": 0,
  "minor_discrepancies": 0,
  "advisory_count": 0,
  "documents_present": ["Commercial Invoice", "Bill of Lading"],
  "documents_missing": [],
  "discrepancies": [
    {
      "id": "D001",
      "severity": "MAJOR | MINOR | ADVISORY",
      "document": "Exact document type label",
      "field": "Specific field name",
      "issue": "Clear, concise description of the problem",
      "rule_reference": "UCP 600 Art. XX / ISBP 821 Para. YY",
      "recommendation": "Suggested corrective action or handling"
    }
  ],
  "summary": "2-3 sentence objective summary of the examination result",
  "recommendation": "ACCEPT | REJECT | RESERVE_FOR_REVIEW"
}`,
  };
}

// ─── Step 4: Report ───────────────────────────────────────────────────────────

export function buildReportPrompt(
  mergedClassifyData: MergedClassifyData,
  extractionResults: ExtractResult[],
  checkResult: LCCheckResult,
  promptOverride?: string,
): Record<string, unknown> {
  const majorIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'MAJOR');
  const minorIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'MINOR');
  const advisoryIssues = (checkResult.discrepancies ?? []).filter(d => d.severity === 'ADVISORY');

  const discrepancyTable = checkResult.discrepancies?.length > 0
    ? checkResult.discrepancies.map(d =>
        `| ${d.id} | ${d.severity} | ${d.document} | ${d.field} | ${d.issue} | ${d.rule_reference} |`
      ).join('\n')
    : '*(No discrepancies found)*';

  const successExtracts = extractionResults.filter(
    (r): r is ExtractFileResult => r.status === 'success',
  );

  const classifySummary = `${mergedClassifyData.files_analyzed} file(s), ${mergedClassifyData.total_logical_documents} document type(s)`;
  const extractionData = JSON.stringify(
    successExtracts.map(r => ({ file: r.file_name, data: r.extracted_data })), null, 2,
  );

  const verdictLabel = {
    COMPLIANT: 'HOP LE (COMPLIANT)',
    DISCREPANT: 'CO SAI LECH (DISCREPANT)',
    PENDING: 'CAN XEM XET (PENDING)',
  }[checkResult.verdict] || checkResult.verdict;

  const recommendationLabel = {
    ACCEPT: 'DE XUAT CHAP NHAN THANH TOAN',
    REJECT: 'DE XUAT TU CHOI THANH TOAN',
    RESERVE_FOR_REVIEW: 'DE XUAT DE DUYET - XEM XET THEM',
  }[checkResult.recommendation] || checkResult.recommendation;

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        classify_summary: classifySummary,
        extraction_data: extractionData,
        verdict: verdictLabel,
        recommendation: recommendationLabel,
        major_count: String(majorIssues.length),
        minor_count: String(minorIssues.length),
        advisory_count: String(advisoryIssues.length),
        discrepancy_table: discrepancyTable,
        check_summary: checkResult.summary || '',
        documents_present: (checkResult.documents_present ?? []).join(', '),
        documents_missing: (checkResult.documents_missing ?? []).join(', '),
      }),
    };
  }

  return {
    _prompt: `You are a senior Trade Finance Officer. Produce a professional LC CHECKING REPORT (Bao cao Kiem tra Chung tu LC) in Vietnamese.

=== INPUT DATA ===

Document set: ${classifySummary}
Documents present: ${(checkResult.documents_present ?? []).join(', ')}
${checkResult.documents_missing?.length > 0 ? `Documents not presented: ${checkResult.documents_missing.join(', ')}` : 'All expected documents accounted for.'}

Extracted data:
${extractionData}

Examination result: ${verdictLabel}
Recommendation: ${recommendationLabel}
Discrepancy count: ${checkResult.total_discrepancies} total (MAJOR: ${majorIssues.length}, MINOR: ${minorIssues.length}, ADVISORY: ${advisoryIssues.length})
Examination summary: ${checkResult.summary}

Discrepancy table:
| ID | Severity | Document | Field | Issue | Rule Reference |
|----|----------|----------|-------|-------|----------------|
${discrepancyTable}

=== REPORT STRUCTURE ===

Write a complete, formal LC Checking Report in Vietnamese using EXACTLY these sections:

## I. THONG TIN BO CHUNG TU
- List each document received: type, reference number, date, issuing party
- Note any documents not presented

## II. KET QUA BOC TACH DU LIEU
- Key extracted fields per document type
- Highlight: amounts, dates, parties, port info, goods description

## III. KET QUA KIEM TRA TUAN THU
- State overall verdict clearly (HOP LE / CO SAI LECH / CAN XEM XET)
- Full discrepancy table with UCP 600 / ISBP 821 references
- Group: MAJOR first, then MINOR, then ADVISORY
- For each MAJOR: explain why it triggers Art. 16 refusal

## IV. NHAN XET VA DE XUAT XU LY
- Professional assessment from examiner's perspective
- If COMPLIANT: recommend acceptance, note any advisory items
- If DISCREPANT: for each MAJOR — state whether correctable (request amendment) or non-correctable (recommend rejection or waiver)
- If RESERVE_FOR_REVIEW: list items requiring senior approval

## V. KET LUAN
- One unambiguous final recommendation in formal banking language
- Examiner signature line placeholder

FORMATTING:
- Language: Vietnamese (professional banking register)
- Audience: Trade Finance Operations Head, Compliance Officer
- Cite UCP 600 articles and ISBP 821 paragraphs explicitly
- Maximum 2,000 words
- Output in Markdown`,
  };
}

// ─── Interpolation Helper ─────────────────────────────────────────────────────

/**
 * Replace {{variable_name}} placeholders in a prompt template.
 */
function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}
