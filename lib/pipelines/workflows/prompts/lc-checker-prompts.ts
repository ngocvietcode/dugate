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



// ─── Step 3: Compliance Check (UCP 600 / ISBP 821 — Self-contained) ──────────

export function buildComplianceCheckPrompt(
  mergedClassifyData: MergedClassifyData,
  promptOverride?: string,
): Record<string, unknown> {
  const classifySummary = JSON.stringify(mergedClassifyData.logical_documents, null, 2);

  if (promptOverride) {
    return {
      _prompt: interpolatePrompt(promptOverride, {
        classify_summary: classifySummary,
      }),
    };
  }

  return {
    _prompt: `You are a senior Documentary Credit (LC) checker with expertise in UCP 600, ISBP 821 (2013 Revision) and eUCP v2.0.

TASK: Examine the presented LC document set for compliance with international standards and internal cross-document consistency.
You are provided with the ORIGINAL RAW DOCUMENTS explicitly attached to this request. Do NOT rely on summarized data — read the textual content, clauses, conditions, and dates directly from the documents yourself to ensure zero information divergence.

=== CLASSIFICATION OVERVIEW ===
The attached documents have been mapped as follows:
${classifySummary}

=== COMPREHENSIVE EXAMINATION RULES (UCP 600 / ISBP 821) ===

[1] COMMERCIAL INVOICE (UCP Art 18, ISBP Sec C)
- Must appear to be issued by the Beneficiary/Seller and made out to the Applicant/Buyer.
- Goods description must correspond exactly to the LC (if LC provided) or be consistent with other documents. No contradicting descriptions allowed.
- Currency must match across all documents.
- Invoice value must not conflict with Draft or any other document.
- Must not show over-shipment or under-shipment (unless LC allows tolerance, default is NO tolerance).

[2] TRANSPORT DOCUMENTS (BILL OF LADING / AIRWAY BILL) (UCP Art 20/23, ISBP Sec E/H)
- Must indicate the name of the carrier and be signed by the carrier, master, or a named agent.
- Must indicate that goods have been shipped on board a named vessel at the port of loading on a specific date. On-board notation is mandatory.
- Port of Loading and Port of Discharge must not contradict other documents.
- Must NOT be "unclean" (i.e., must not contain detrimental clauses regarding the goods or packaging).
- Consignee and Notify Party must be consistent with standard practices.

[3] INSURANCE DOCUMENTS (UCP Art 28, ISBP Sec K)
- Must appear to be issued and signed by an insurance company, underwriter, or their agents/proxies.
- Must indicate the amount of insurance coverage (minimum 110% of CIF/CIP value unless otherwise specified).
- Risks must be covered at least between the shipment port and discharge port.
- Date of issue must NOT be later than the date of shipment (on-board date).

[4] CERTIFICATE OF ORIGIN & OTHER CERTS (ISBP Sec L/M)
- Must be issued by the stated authority or appear to be by a neutral party.
- Country of origin must not contradict the Invoice.
- Information must not conflict with the B/L or Invoice (e.g., vessel name, marks, quantities, dates).

[5] CROSS-DOCUMENT CONSISTENCY (UCP Art 14.d)
- Data in a document, when read in context with the credit, the document itself and international standard banking practice, need not be identical to, but must not conflict with, data in that document, any other stipulated document or the credit.
- Dates: Invoice date <= Shipment date; Insurance date <= Shipment date; Inspection date <= Shipment date.
- Weights/Quantities: Must tally exactly across Invoice, Packing List, B/L, and Certificates.

=== GUARDRAILS & REASONING (MUST FOLLOW) ===
Before issuing the final verdict, you MUST synthesize a step-by-step reasoning process in the "examination_log" array.
For EACH document, explicitly state:
1. What you verified (e.g., Dates, Amounts, Signatures, Clauses).
2. Whether you found conflicts or missing data objectively.
Only after documenting your findings step-by-step should you determine the discrepancy severity.

=== SEVERITY DEFINITIONS ===
- MAJOR    -> must cause refusal under UCP 600 Art. 16. (e.g., Unclean B/L, value conflicts, missing mandatory docs, late shipment)
- MINOR    -> formal issue; may be acceptable or requires clarification at examiner's discretion. (e.g., minor typos, omitted unimportant details)
- ADVISORY -> observation or absent optional element; no automatic refusal.

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
  "examination_log": [
    "Step 1: Analyzed Invoice. Value is USD 50,000. Description matches.",
    "Step 2: Analyzed B/L. Clean on board. Date is 15-Apr-2025.",
    "Step 3: Cross-check - B/L date is after Invoice date (Pass). Weights match between B/L and PL."
  ],
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

  const classifySummary = `${mergedClassifyData.files_analyzed} file(s), ${mergedClassifyData.total_logical_documents} document type(s)`;

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

## II. DANH SACH CHUNG TU
- Review the attached files and list their identifiers clearly.

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
