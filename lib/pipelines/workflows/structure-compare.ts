// lib/pipelines/workflows/structure-compare.ts
// Workflow: So sánh theo Cấu trúc Ánh xạ (Structure-Mapped Comparison)
//
// OPTIMIZED 2-PHASE APPROACH:
//   Phase 1 (before PAUSE): Layout-only OCR → Structure Extract → Auto-map → [User confirm]
//   Phase 2 (after PAUSE):  Send 2 original files + confirmed mapping → Full comparison → Report
//
// Phase 1 is fast (layout-only OCR, no full text needed).
// Phase 2 is accurate (AI reads original PDF + knows exactly which sections to compare).

import {
  type WorkflowContext,
  enqueueSubStep,
  updateProgress,
  pauseWorkflow,
  completeWorkflow,
} from '@/lib/pipelines/workflow-engine';

import {
  buildStructureExtractionPrompt,
  parseStructureExtractionResult,
  buildSectionComparisonPrompt,
  parseSectionComparisonResult,
  type StructureExtractionInput,
  type StructureExtractionResult,
  type SectionComparisonInput,
} from '@/lib/pipelines/workflows/prompts/structure-compare-prompts';
import { parseHeadings, type ParsedHeading } from '@/lib/structure-compare/heading-parser';
import { mapSections, flattenSections } from '@/lib/structure-compare/section-mapper';
import { aggregateReport } from '@/lib/structure-compare/report-aggregator';
import type { DocumentOutline, OutlineSection, MappingTable, ChangeRecord } from '@/lib/structure-compare/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4; // Phase 1: Layout OCR + Extract + Map | Phase 2: Compare + Report

/** Progress percentage ranges for each step [start, end] */
const STEP_PROGRESS: Record<number, [number, number]> = {
  0: [5, 25],   // Layout OCR (fast)
  1: [30, 50],  // Structure Extraction + Auto-Mapping
  2: [55, 60],  // Auto-Mapping (code, instant)
  3: [65, 90],  // Full Comparison (Phase 2)
  4: [92, 98],  // Report Aggregation
};

function stepProgress(stepIdx: number, phase: 'start' | 'end'): number {
  const range = STEP_PROGRESS[stepIdx];
  if (!range) return 50;
  return phase === 'start' ? range[0] : range[1];
}

// ─── Step 1: Layout-Only OCR ──────────────────────────────────────────────────

/**
 * Build a LAYOUT-ONLY OCR prompt for Phase 1.
 * Only extracts headings, section numbers, and table of contents — NOT full text.
 * This is much faster and cheaper than full OCR.
 */
function buildLayoutOcrPrompt(fileName: string, promptOverride?: string): Record<string, unknown> {
  if (promptOverride) {
    return {
      _prompt: promptOverride.replace(/\{\{\s*file_name\s*\}\}/g, fileName),
    };
  }

  return {
    _prompt: `You are a Document Structure Scanner.

FILE: "${fileName}"

=== TASK ===
Extract ONLY the document structure/outline — headings, section numbers, article titles, and table of contents.
Do NOT transcribe the full body text of each section.

=== WHAT TO EXTRACT ===

1. TABLE OF CONTENTS (if present): Copy it verbatim — this is the most important output.

2. ALL HEADINGS AND SECTION MARKERS in document order:
   - Part/Phần headings
   - Chapter/Chương headings
   - Section/Mục headings
   - Article/Điều headings with their titles
   - Numbered sections (I., II., 1., 2., 1.1, etc.)
   - Any bold/large-font text that serves as a heading

3. For each heading, include:
   - The exact heading text as it appears
   - The page number (if visible)
   - A brief snippet (first 20 words) of the content under that heading

=== FORMAT ===

Output as structured text:

[TOC] (if found)
<copy table of contents verbatim>
[/TOC]

[HEADINGS]
Page X: # Heading Level 1 Text
Page X: ## Heading Level 2 Text
Page X: ### Heading Level 3 Text (first 20 words of content...)
[/HEADINGS]

=== RULES ===
- DO extract every heading/section marker in the document
- DO preserve exact numbering (Điều 1, Chương II, Mục 3, etc.)
- DO NOT transcribe full paragraph text — only headings and brief snippets
- DO NOT skip any pages — scan all pages for headings
- This is a FAST SCAN — prioritize speed over completeness of body text`,
  };
}

/**
 * Step 1: Layout-only OCR for both documents in parallel.
 * Only extracts headings/TOC — much faster than full OCR.
 * Stores layout text + file references in stepsResultJson step 0.
 */
async function stepIngest(ctx: WorkflowContext): Promise<void> {
  const { logger, filesData } = ctx;

  // Validate: we need exactly 2 documents for structure-mapped comparison
  if (filesData.length < 2) {
    throw new Error(
      `Cần ít nhất 2 tài liệu để so sánh cấu trúc. Chỉ nhận được ${filesData.length} file.`,
    );
  }

  // Use the first two files as V1 and V2
  const v1File = filesData[0];
  const v2File = filesData[1];

  logger.info(
    `[STRUCTURE-COMPARE] Phase 1, Step 1/${TOTAL_STEPS}: Layout-only OCR — V1: "${v1File.name}", V2: "${v2File.name}"`,
  );
  await updateProgress(
    ctx,
    stepProgress(0, 'start'),
    `Bước 1/${TOTAL_STEPS}: Đang quét cấu trúc tài liệu (layout scan)...`,
  );

  // Layout-only OCR both documents in parallel
  const ingestPromises = [v1File, v2File].map(async (file, idx) => {
    const docLabel = idx === 0 ? 'V1' : 'V2';
    const singleFileJson = JSON.stringify([file]);

    try {
      const result = await enqueueSubStep(
        ctx,
        'ext-doc-layout',
        buildLayoutOcrPrompt(file.name, ctx.promptOverrides.ingest),
        singleFileJson,
        ctx.modelOverrides.ingest,
        ctx.reasoningEffortOverrides.ingest,
      );

      const contentLength = (result.content || '').length;
      logger.info(
        `[STRUCTURE-COMPARE] Step 1 Ingest ${docLabel} ("${file.name}"): ${contentLength} chars`,
      );

      return {
        doc_id: `${docLabel.toLowerCase()}-${file.name}`,
        doc_label: `${docLabel}: ${file.name}`,
        fileName: file.name,
        content: result.content || '',
        subOpId: result.operation.id,
        status: 'success' as const,
      };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(
        `[STRUCTURE-COMPARE] Ingest failed for ${docLabel} ("${file.name}"): ${errMsg}`,
      );

      return {
        doc_id: `${docLabel.toLowerCase()}-${file.name}`,
        doc_label: `${docLabel}: ${file.name}`,
        fileName: file.name,
        content: '',
        subOpId: '',
        status: 'error' as const,
        error: errMsg,
      };
    }
  });

  const ingestResults = await Promise.all(ingestPromises);

  // Check for failures — both documents must be ingested successfully
  const failures = ingestResults.filter((r) => r.status === 'error');
  if (failures.length > 0) {
    const failedNames = failures.map((f) => f.fileName).join(', ');
    const errorDetails = failures.map((f) => `${f.fileName}: ${f.error}`).join('; ');
    throw new Error(
      `Không thể đọc tài liệu: ${failedNames}. Vui lòng kiểm tra định dạng file. Chi tiết: ${errorDetails}`,
    );
  }

  // Verify we got actual content from both documents
  const emptyDocs = ingestResults.filter((r) => r.content.length === 0);
  if (emptyDocs.length > 0) {
    const emptyNames = emptyDocs.map((d) => d.fileName).join(', ');
    throw new Error(
      `Tài liệu không có nội dung sau khi OCR: ${emptyNames}. Vui lòng kiểm tra file không bị trống hoặc hỏng.`,
    );
  }

  // Store step 0 results (layout text)
  ctx.stepsResult.push({
    step: 0,
    stepName: 'Layout OCR',
    processor: 'ext-doc-layout',
    content_preview: JSON.stringify(
      ingestResults.map((r) => ({
        doc_id: r.doc_id,
        status: r.status,
        chars: r.content.length,
      })),
    ),
    sub_results: ingestResults.map((r) => ({
      doc_id: r.doc_id,
      doc_label: r.doc_label,
      content: r.content,
      status: r.status,
      sub_operation_id: r.subOpId,
    })),
  });

  const totalChars = ingestResults.reduce((sum, r) => sum + r.content.length, 0);
  await updateProgress(
    ctx,
    stepProgress(0, 'end'),
    `Bước 1 hoàn tất. Đã quét cấu trúc 2 tài liệu (${totalChars.toLocaleString()} ký tự layout).`,
  );
}

// ─── Step 2: Structure Extraction ─────────────────────────────────────────────

/** Threshold below which a document is flagged as "structure uncertain" */
const CONFIDENCE_UNCERTAIN_THRESHOLD = 60;

/**
 * Detect whether a document text likely contains Vietnamese legal patterns.
 * Used to decide whether to apply heading-parser as validation/fast-path.
 */
function isLikelyVietnameseLegal(text: string): boolean {
  const vnPatterns = [
    /\b(Điều|ĐIỀU|Dieu|DIEU)\s+\d+/i,
    /\b(Khoản|KHOẢN|Khoan|KHOAN)\s+\d+/i,
    /\b(Chương|CHƯƠNG|Chuong|CHUONG)\s+[IVXLCDM\d]+/i,
    /\b(Mục|MỤC)\s+\d+/i,
    /\b(Phần|PHẦN)\s+[IVXLCDM\d]+/i,
  ];
  let matchCount = 0;
  for (const pattern of vnPatterns) {
    if (pattern.test(text)) matchCount++;
  }
  // Consider it Vietnamese legal if at least 2 different pattern types are found
  return matchCount >= 2;
}

/**
 * Merge heading-parser results into AI-extracted sections for validation.
 * The heading-parser provides accurate character positions and hierarchy levels
 * for Vietnamese legal patterns. We use it to:
 * 1. Validate AI-extracted section boundaries
 * 2. Supplement missing sections the AI may have missed
 * 3. Correct hierarchy levels based on known Vietnamese legal patterns
 */
function mergeHeadingParserResults(
  aiResult: StructureExtractionResult,
  parsedHeadings: ParsedHeading[],
  documentText: string,
): StructureExtractionResult {
  if (parsedHeadings.length === 0) return aiResult;

  // If AI returned a single fallback section (low confidence), replace with heading-parser results
  if (
    aiResult.sections.length === 1 &&
    aiResult.confidence < 40
  ) {
    return buildOutlineFromHeadings(parsedHeadings, documentText, aiResult);
  }

  // If AI has reasonable results, use heading-parser to validate and boost confidence
  // Check how many AI sections align with heading-parser findings
  let alignedCount = 0;
  for (const heading of parsedHeadings) {
    const matchingSection = aiResult.sections.find(
      (s) =>
        Math.abs(s.startPos - heading.startPos) < 20 &&
        s.identifier.includes(heading.identifier.split(' ')[0]),
    );
    if (matchingSection) alignedCount++;
  }

  const alignmentRatio = parsedHeadings.length > 0
    ? alignedCount / parsedHeadings.length
    : 0;

  // If alignment is high (>70%), boost confidence slightly
  if (alignmentRatio > 0.7) {
    aiResult.confidence = Math.min(100, aiResult.confidence + 10);
  }
  // If alignment is low (<30%) and heading-parser found many headings,
  // prefer heading-parser results
  else if (alignmentRatio < 0.3 && parsedHeadings.length > aiResult.sections.length) {
    return buildOutlineFromHeadings(parsedHeadings, documentText, aiResult);
  }

  return aiResult;
}

/**
 * Build a StructureExtractionResult from heading-parser output.
 * Used when the heading-parser provides better results than AI extraction.
 */
function buildOutlineFromHeadings(
  headings: ParsedHeading[],
  documentText: string,
  originalResult: StructureExtractionResult,
): StructureExtractionResult {
  const sections = headings.map((heading, idx) => {
    const nextHeading = headings[idx + 1];
    const endPos = nextHeading ? nextHeading.startPos : documentText.length;
    const content = documentText.slice(heading.endPos, endPos).trim();

    return {
      id: `sec-${idx + 1}`,
      identifier: heading.identifier,
      title: heading.title || content.slice(0, 80).split('\n')[0],
      level: heading.level,
      startPos: heading.startPos,
      endPos,
      content,
      children: [] as ParsedSection[],
    };
  });

  return {
    documentId: originalResult.documentId,
    documentName: originalResult.documentName,
    sections,
    confidence: Math.max(originalResult.confidence, 75), // heading-parser is reliable
    source: 'inferred',
  };
}

// Import ParsedSection type for local use
type ParsedSection = import('@/lib/pipelines/workflows/prompts/structure-compare-prompts').ParsedSection;

/**
 * Convert a StructureExtractionResult into a DocumentOutline.
 * Applies confidence threshold flagging and builds OutlineSection tree.
 */
function buildDocumentOutline(result: StructureExtractionResult): DocumentOutline {
  const sections: OutlineSection[] = result.sections.map((s) => ({
    id: s.id,
    identifier: s.identifier,
    title: s.title,
    level: s.level,
    startPos: s.startPos,
    endPos: s.endPos,
    content: s.content,
    children: s.children?.map((child) => ({
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      level: child.level,
      startPos: child.startPos,
      endPos: child.endPos,
      content: child.content,
      children: child.children?.map((grandchild) => ({
        id: grandchild.id,
        identifier: grandchild.identifier,
        title: grandchild.title,
        level: grandchild.level,
        startPos: grandchild.startPos,
        endPos: grandchild.endPos,
        content: grandchild.content,
      })) || [],
    })) || [],
    ocrConfidence: s.ocrConfidence,
  }));

  return {
    documentId: result.documentId,
    documentName: result.documentName,
    sections,
    confidence: result.confidence,
    isUncertain: result.confidence < CONFIDENCE_UNCERTAIN_THRESHOLD,
    source: result.source,
  };
}

/**
 * Step 2: Structure Extraction.
 * For each document, calls the AI connector to extract hierarchical structure.
 * Uses heading-parser as validation/fast-path for Vietnamese legal documents.
 * Produces two DocumentOutline objects and stores them in stepsResultJson step 1.
 */
async function stepStructureExtraction(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  logger.info(
    `[STRUCTURE-COMPARE] Step 2/${TOTAL_STEPS}: Extracting document structure`,
  );
  await updateProgress(
    ctx,
    stepProgress(1, 'start'),
    `Bước 2/${TOTAL_STEPS}: Đang trích xuất cấu trúc tài liệu...`,
  );

  // Get ingested text content from step 0 results
  const ingestStep = ctx.stepsResult[0];
  if (!ingestStep || !ingestStep.sub_results || !Array.isArray(ingestStep.sub_results)) {
    throw new Error(
      'Không tìm thấy kết quả OCR (Step 1). Vui lòng chạy lại workflow.',
    );
  }

  const subResults = ingestStep.sub_results as Array<{
    doc_id: string;
    doc_label: string;
    content: string;
    status: string;
    sub_operation_id: string;
  }>;

  if (subResults.length < 2) {
    throw new Error(
      `Cần kết quả OCR của 2 tài liệu nhưng chỉ có ${subResults.length}.`,
    );
  }

  const outlines: DocumentOutline[] = [];
  const notifications: string[] = [];

  for (let idx = 0; idx < 2; idx++) {
    const docResult = subResults[idx];
    const docLabel = idx === 0 ? 'V1' : 'V2';
    const documentText = docResult.content;
    const fileName = docResult.doc_label.replace(/^V[12]: /, '');

    logger.info(
      `[STRUCTURE-COMPARE] Step 2 Extracting structure for ${docLabel} ("${fileName}"): ${documentText.length} chars`,
    );

    // Determine format hint from file extension
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const formatHint = ['pdf', 'docx', 'doc', 'txt', 'md'].includes(ext) ? ext : undefined;

    // Build the extraction input
    const extractionInput: StructureExtractionInput = {
      documentId: docResult.doc_id,
      documentName: fileName,
      documentText,
      formatHint,
      isOcr: false, // TODO: detect from ingest metadata if available
    };

    // Call AI connector for structure extraction
    let aiExtractionResult: StructureExtractionResult;
    try {
      const prompt = buildStructureExtractionPrompt(
        extractionInput,
        ctx.promptOverrides.structure_extraction,
      );

      const result = await enqueueSubStep(ctx, 'ext-data-extractor', prompt, null, ctx.modelOverrides.structure_extraction, ctx.reasoningEffortOverrides.structure_extraction);

      logger.info(
        `[STRUCTURE-COMPARE] Step 2 AI extraction ${docLabel}: ${(result.content || '').length} chars response`,
      );

      aiExtractionResult = parseStructureExtractionResult(result.content, extractionInput);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.warn(
        `[STRUCTURE-COMPARE] AI structure extraction failed for ${docLabel} ("${fileName}"): ${errMsg}. Falling back to heading-parser.`,
      );

      // Fallback: use heading-parser only
      aiExtractionResult = {
        documentId: extractionInput.documentId,
        documentName: extractionInput.documentName,
        sections: [{
          id: 'sec-1',
          identifier: 'Document',
          title: fileName,
          level: 1,
          startPos: 0,
          endPos: documentText.length,
          content: documentText,
        }],
        confidence: 20,
        source: 'ai_extracted',
      };
    }

    // Use heading-parser as validation/fast-path for Vietnamese legal documents
    if (isLikelyVietnameseLegal(documentText)) {
      logger.info(
        `[STRUCTURE-COMPARE] Step 2 ${docLabel}: Detected Vietnamese legal document, applying heading-parser validation`,
      );
      const parsedHeadings = parseHeadings(documentText);
      aiExtractionResult = mergeHeadingParserResults(
        aiExtractionResult,
        parsedHeadings,
        documentText,
      );
    }

    // Build DocumentOutline from the extraction result
    const outline = buildDocumentOutline(aiExtractionResult);

    // Handle flat text documents (no structure): treat as single section, notify user
    if (outline.sections.length <= 1 && outline.confidence < 40) {
      notifications.push(
        `${docLabel} ("${fileName}"): Tài liệu không có cấu trúc rõ ràng. Khuyến nghị dùng So sánh Ngữ nghĩa thông thường.`,
      );
      logger.warn(
        `[STRUCTURE-COMPARE] Step 2 ${docLabel}: Flat text document (no discernible structure)`,
      );
    }

    // Flag documents with confidence < 60% as uncertain
    if (outline.isUncertain) {
      logger.warn(
        `[STRUCTURE-COMPARE] Step 2 ${docLabel}: Low confidence (${outline.confidence}%), flagged as uncertain`,
      );
    }

    outlines.push(outline);

    logger.info(
      `[STRUCTURE-COMPARE] Step 2 ${docLabel} complete: ${outline.sections.length} sections, ` +
      `confidence=${outline.confidence}%, source=${outline.source}, uncertain=${outline.isUncertain}`,
    );
  }

  const [v1Outline, v2Outline] = outlines;

  // Store step 1 results
  ctx.stepsResult.push({
    step: 1,
    stepName: 'Structure Extraction',
    processor: 'ext-data-extractor',
    content_preview: JSON.stringify({
      v1: { sections: v1Outline.sections.length, confidence: v1Outline.confidence, source: v1Outline.source },
      v2: { sections: v2Outline.sections.length, confidence: v2Outline.confidence, source: v2Outline.source },
      notifications: notifications.length > 0 ? notifications : undefined,
    }),
    extracted_data: {
      v1Outline,
      v2Outline,
    },
  });

  const uncertainNote = outlines.some((o) => o.isUncertain)
    ? ' ⚠️ Cấu trúc không chắc chắn — vui lòng xác nhận.'
    : '';
  const flatNote = notifications.length > 0
    ? ` ℹ️ ${notifications.join(' ')}`
    : '';

  await updateProgress(
    ctx,
    stepProgress(1, 'end'),
    `Bước 2 hoàn tất. V1: ${v1Outline.sections.length} mục, V2: ${v2Outline.sections.length} mục.${uncertainNote}${flatNote}`,
  );
}

// ─── Step 3: Auto-Mapping + PAUSE ─────────────────────────────────────────────

/**
 * Step 3: Auto-map sections between the two document outlines.
 * Uses the section-mapper algorithm (Hungarian + multi-signal scoring).
 * Stores the MappingTable in stepsResultJson step 2, then pauses
 * the workflow for user review (WAITING_USER_INPUT).
 */
async function stepAutoMapping(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  logger.info(
    `[STRUCTURE-COMPARE] Step 3/${TOTAL_STEPS}: Auto-mapping sections between documents`,
  );
  await updateProgress(
    ctx,
    stepProgress(2, 'start'),
    `Bước 3/${TOTAL_STEPS}: Đang tự động ghép cặp các phần giữa hai tài liệu...`,
  );

  // Get the two DocumentOutline objects from step 2 (structure extraction) results
  const structureStep = ctx.stepsResult[1];
  if (!structureStep || !structureStep.extracted_data) {
    throw new Error(
      'Không tìm thấy kết quả trích xuất cấu trúc (Step 2). Vui lòng chạy lại workflow.',
    );
  }

  const { v1Outline, v2Outline } = structureStep.extracted_data as {
    v1Outline: DocumentOutline;
    v2Outline: DocumentOutline;
  };

  if (!v1Outline || !v2Outline) {
    throw new Error(
      'Dữ liệu cấu trúc tài liệu không hợp lệ. Thiếu v1Outline hoặc v2Outline.',
    );
  }

  // Call section-mapper to produce MappingTable
  const sessionId = ctx.operationId;
  const mapperResult = mapSections(v1Outline, v2Outline, sessionId);
  const { mappingTable, warning } = mapperResult;

  logger.info(
    `[STRUCTURE-COMPARE] Step 3 Auto-mapping complete: ${mappingTable.entries.length} entries, ` +
    `${mappingTable.autoMappedPercentage}% auto-mapped` +
    (warning ? ` [WARNING: ${warning}]` : ''),
  );

  // Store the MappingTable in stepsResultJson step 2
  const stepResult: Record<string, unknown> = {
    step: 2,
    stepName: 'Auto-Mapping',
    processor: 'section-mapper',
    content_preview: JSON.stringify({
      totalEntries: mappingTable.entries.length,
      autoMappedPercentage: mappingTable.autoMappedPercentage,
      needsReviewCount: mappingTable.entries.filter((e) => e.needsReview).length,
      hasWarning: !!warning,
    }),
    extracted_data: mappingTable,
  };

  // If the mapper returned a low-overlap warning, include it in the step result
  if (warning) {
    (stepResult as Record<string, unknown>).warning = warning;
  }

  ctx.stepsResult.push(stepResult as any);

  await updateProgress(
    ctx,
    stepProgress(2, 'end'),
    `Bước 3 hoàn tất. Đã ghép cặp ${mappingTable.entries.length} mục (${mappingTable.autoMappedPercentage}% tự động).` +
    (warning ? ` ⚠️ ${warning}` : ''),
  );

  // Pause workflow — wait for user to review and confirm the mapping
  const pauseMessage = warning
    ? `Vui lòng xem xét bảng mapping. ⚠️ ${warning}`
    : `Vui lòng xem xét và xác nhận bảng mapping (${mappingTable.entries.filter((e) => e.needsReview).length} mục cần kiểm tra).`;

  return pauseWorkflow(ctx, pauseMessage, 3);
}

// ─── Step 4: Full Comparison (Phase 2) ────────────────────────────────────────

/**
 * Build prompt for full document comparison with mapping context.
 * Sends the confirmed mapping table so AI knows exactly which sections to compare.
 * AI reads the original PDF files directly for maximum accuracy.
 */
function buildFullComparisonPrompt(
  mappingTable: MappingTable,
  v1FileName: string,
  v2FileName: string,
  promptOverride?: string,
): Record<string, unknown> {
  // Serialize mapping for the prompt
  const mappingJson = JSON.stringify(
    mappingTable.entries
      .filter(e => e.matchType !== 'SAME')
      .map(e => ({
        id: e.id,
        matchType: e.matchType,
        v1: e.v1Sections,
        v2: e.v2Sections,
      })),
    null,
    2,
  );

  // Build section identifier lookup for display
  const v1Sections = flattenSections(mappingTable.v1Outline.sections);
  const v2Sections = flattenSections(mappingTable.v2Outline.sections);
  const sectionLabels = JSON.stringify({
    v1: Object.fromEntries(v1Sections.map(s => [s.id, `${s.identifier} ${s.title}`.trim()])),
    v2: Object.fromEntries(v2Sections.map(s => [s.id, `${s.identifier} ${s.title}`.trim()])),
  }, null, 2);

  if (promptOverride) {
    return {
      _prompt: promptOverride
        .replace(/\{\{\s*v1_file_name\s*\}\}/g, v1FileName)
        .replace(/\{\{\s*v2_file_name\s*\}\}/g, v2FileName)
        .replace(/\{\{\s*mapping_json\s*\}\}/g, mappingJson)
        .replace(/\{\{\s*section_labels\s*\}\}/g, sectionLabels),
    };
  }

  return {
    _prompt: `# Lưu ý
Bạn là chuyên gia phân tích hợp đồng pháp lý. Nhiệm vụ: so sánh 2 phiên bản hợp đồng dựa trên BẢNG ÁNH XẠ (mapping table) đã được xác nhận, và báo cáo ĐÚNG các điểm khác biệt — không thêm, không bỏ sót.

NGUYÊN TẮC BẮT BUỘC:
- CHỈ so sánh NỘI DUNG VĂN BẢN (text content). KHÔNG so sánh format, font, layout.
- Mỗi điểm khác biệt PHẢI có trích dẫn nguyên văn từ CẢ HAI phiên bản
- Trích dẫn sao chép trực tiếp từ tài liệu, không tái tạo từ trí nhớ
- BỎ SÓT khác biệt thực sự là LỖI NGHIÊM TRỌNG, tương đương với bịa ra khác biệt
- Nếu V1 có nội dung mà V2 không có (hoặc ngược lại) → PHẢI báo cáo
- Chỉ kết luận "giống nhau" khi đã xác nhận TỪNG điều khoản đều khớp nội dung 1:1

LỖI PHẢI TRÁNH:
- Bịa ra khác biệt không tồn tại (false positive)
- BỎ SÓT khác biệt thực sự (false negative) — LỖI NÀY CŨNG NGHIÊM TRỌNG
- Đọc sai số (30 ≠ 300, 10% ≠ 10,5%)
- Nhầm số điều với số khoản
- Coi lỗi OCR/encoding là thay đổi nội dung
- Coi thay đổi format/font/layout là thay đổi nội dung
- Nhầm điều khoản mới thêm (STR-ADD) với điều khoản bị đổi số (STR-REN)

=== TÀI LIỆU ===
V1 (bản cũ): "${v1FileName}" — file đính kèm THỨ NHẤT
V2 (bản mới): "${v2FileName}" — file đính kèm THỨ HAI

=== BẢNG ÁNH XẠ (đã xác nhận) ===
Chỉ so sánh các cặp bên dưới. Với mỗi cặp, đọc TOÀN BỘ nội dung (bao gồm tất cả Khoản, Điểm bên trong).

${mappingJson}

=== NHÃN CÁC MỤC ===
${sectionLabels}

=== QUY TRÌNH SO SÁNH ===

BƯỚC 1: Đọc toàn bộ cả 2 hợp đồng. Đếm tổng số điều khoản mỗi phiên bản.
CHECKPOINT: Nếu số điều khoản V1 ≠ V2 → CHẮC CHẮN có thêm/xóa. Phải tìm ra.

BƯỚC 2: Với mỗi cặp trong bảng ánh xạ:
- Đọc toàn bộ nội dung CẢ HAI phía (bao gồm mọi Khoản, Điểm bên trong)
- Align từng khoản/điểm giữa V1 và V2
- Nếu khoản có trong V1 nhưng KHÔNG có trong V2 → báo cáo (v1Quote = nội dung, v2Quote = "[KHÔNG CÓ TRONG V2]")
- Nếu khoản có trong V2 nhưng KHÔNG có trong V1 → báo cáo (v1Quote = "[KHÔNG CÓ TRONG V1]", v2Quote = nội dung)
- Nếu cả hai có nhưng NỘI DUNG KHÁC → báo cáo với trích dẫn cả hai phía
- Với mỗi thay đổi, xác định CỤ THỂ từ/cụm từ nào thay đổi

BƯỚC 3: Kiểm tra cuối cùng:
- Đã so sánh hết tất cả các cặp trong bảng ánh xạ chưa?
- Mỗi điều khoản V1 đã được xử lý chưa? Mỗi điều khoản V2 đã được xử lý chưa?
- Nếu tổng thay đổi = 0 nhưng số điều khoản V1 ≠ V2 → KẾT QUẢ SAI, tìm lại.

=== PHÂN LOẠI MỨC ĐỘ ===
- [CRITICAL]: Nghĩa vụ, quyền, tiền tệ, thời hạn pháp lý, phạm vi thay đổi. Cam kết "vô điều kiện". Quyền thu giữ/kiểm soát mới.
- [MAJOR]: Thay đổi đáng kể: deadline (15 ngày → 5 ngày), mở rộng danh sách nghĩa vụ, thêm điều kiện xử lý mới (bị khởi tố, cưỡng chế...)
- [MODERATE]: Thay đổi quy trình, làm rõ điều khoản, bổ sung thủ tục hành chính
- [MINOR]: Từ ngữ thay đổi nhẹ, không đổi ý nghĩa pháp lý
- [STRUCTURAL]: Chỉ đổi số thứ tự, nội dung không thay đổi

=== MÃ LOẠI THAY ĐỔI ===
STR-ADD: Thêm điều khoản mới | STR-DEL: Xóa điều khoản | STR-REN: Đổi số thứ tự
CON-VAL: Giá trị tiền tệ | CON-PARTY: Thông tin bên ký | CON-OBL: Nghĩa vụ
CON-RIGHT: Quyền | CON-TERM: Điều kiện chấm dứt | CON-PENALTY: Phạt/bồi thường
CON-SCOPE: Phạm vi | CON-PROC: Quy trình | CON-DEF: Định nghĩa

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown fences, no explanation outside JSON).
Mỗi thay đổi = 1 object. Nếu 1 điều khoản có 3 thay đổi → 3 objects riêng biệt.

[
  {
    "code": "CR-001",
    "severity": "CRITICAL",
    "mappingEntryId": "<id từ bảng ánh xạ>",
    "v1SectionId": "<section id V1>",
    "v2SectionId": "<section id V2>",
    "description": "Thay đổi gì: <mô tả cụ thể>\\nTác động: <phân tích tác động pháp lý>",
    "v1Quote": "<trích dẫn NGUYÊN VĂN từ V1 — sao chép chính xác, không rút gọn>",
    "v2Quote": "<trích dẫn NGUYÊN VĂN từ V2 — sao chép chính xác, không rút gọn>",
    "category": "CON-OBL"
  }
]

=== QUY TẮC TRÍCH DẪN ===
- v1Quote: sao chép NGUYÊN VĂN từ V1. Nếu điều khoản mới (không có trong V1): "[KHÔNG CÓ TRONG V1]"
- v2Quote: sao chép NGUYÊN VĂN từ V2. Nếu bị xóa (không có trong V2): "[KHÔNG CÓ TRONG V2]"
- KHÔNG tóm tắt, KHÔNG rút gọn, KHÔNG diễn giải
- Giữ nguyên từng từ, từng số, từng dấu câu
- Nếu nội dung dài: vẫn phải trích dẫn đầy đủ

=== KIỂM TRA CUỐI CÙNG (bắt buộc trước khi output) ===
1. Nếu chỉ tìm được 1-2 thay đổi cho một hợp đồng nhiều điều khoản → BẠN ĐÃ BỎ SÓT. Đọc lại cẩn thận hơn.
2. Đếm: mỗi điều khoản V1 đã được xử lý chưa? Mỗi điều khoản V2 đã được xử lý chưa?
3. Nếu số điều khoản V1 ≠ V2 mà không có STR-ADD hoặc STR-DEL → BẠN ĐÃ BỎ SÓT.
4. Kiểm tra: có điều khoản nào bị đổi số (STR-REN cascading) do thêm/xóa mà chưa báo cáo không?`,
  };
}

/**
 * Step 4: Full Comparison (Phase 2).
 * Sends the 2 original files + confirmed mapping to AI for comparison.
 * For documents > 50 pages, falls back to per-pair comparison.
 */
async function stepFullComparison(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  logger.info(
    `[STRUCTURE-COMPARE] Phase 2, Step 4/${TOTAL_STEPS}: Full comparison with original files`,
  );
  await updateProgress(
    ctx,
    stepProgress(3, 'start'),
    `Bước 4/${TOTAL_STEPS}: Đang so sánh chi tiết (gửi file gốc + mapping)...`,
  );

  // Read confirmed MappingTable
  const mappingStep = ctx.stepsResult.find((s) => s.step === 2);
  if (!mappingStep || !mappingStep.extracted_data) {
    throw new Error('Không tìm thấy bảng mapping đã xác nhận. Vui lòng chạy lại workflow.');
  }
  const mappingTable = mappingStep.extracted_data as MappingTable;

  // Get file references — files are already on server from initial upload (ctx.filesData)
  const filesData = ctx.filesData;
  if (!filesData || filesData.length < 2) {
    throw new Error('Không tìm thấy file gốc để so sánh. Vui lòng chạy lại workflow.');
  }

  const v1File = filesData[0];
  const v2File = filesData[1];

  const entriesToCompare = mappingTable.entries.filter(e => e.matchType !== 'SAME');

  if (entriesToCompare.length === 0) {
    logger.info('[STRUCTURE-COMPARE] Step 4: No pairs to compare (all SAME)');
    ctx.stepsResult.push({
      step: 3,
      stepName: 'Section Comparison',
      processor: 'ext-comparator',
      content_preview: JSON.stringify({ totalChanges: 0, strategy: 'skip' }),
      extracted_data: [],
    });
    await updateProgress(ctx, stepProgress(3, 'end'), 'Bước 4 hoàn tất. Không có thay đổi.');
    return;
  }

  let allChangeRecords: ChangeRecord[];

  // Always use single-call strategy: upload 2 original files + mapping JSON
  // AI reads both documents directly and compares based on the mapping table
  logger.info(`[STRUCTURE-COMPARE] Step 4: Single-call comparison (2 files + mapping, ${entriesToCompare.length} pairs)`);
  allChangeRecords = await compareSingleCall(ctx, mappingTable, v1File, v2File);

  // Store step 3 results
  ctx.stepsResult.push({
    step: 3,
    stepName: 'Section Comparison',
    processor: 'ext-comparator',
    content_preview: JSON.stringify({
      totalChanges: allChangeRecords.length,
      pairsCompared: entriesToCompare.length,
      strategy: 'single-call',
    }),
    extracted_data: allChangeRecords,
  });

  await updateProgress(
    ctx,
    stepProgress(3, 'end'),
    `Bước 4 hoàn tất. Phát hiện ${allChangeRecords.length} thay đổi.`,
  );
}

/**
 * Primary strategy: Send both original files + mapping in a single AI call.
 * AI reads PDFs directly and compares based on the mapping table.
 */
async function compareSingleCall(
  ctx: WorkflowContext,
  mappingTable: MappingTable,
  v1File: any,
  v2File: any,
): Promise<ChangeRecord[]> {
  const prompt = buildFullComparisonPrompt(
    mappingTable,
    v1File.name,
    v2File.name,
    ctx.promptOverrides.section_comparison,
  );

  // Send both files together
  const bothFilesJson = JSON.stringify([v1File, v2File]);

  const result = await enqueueSubStep(ctx, 'ext-comparator', prompt, bothFilesJson, ctx.modelOverrides.section_comparison, ctx.reasoningEffortOverrides.section_comparison);

  const records = parseSectionComparisonResult(
    result.content,
    '', // mappingEntryId will be in each record from AI
    '',
    '',
  );

  // Ensure all records have valid fields
  return records.map((r, idx) => ({
    ...r,
    code: r.code || `CR-${String(idx + 1).padStart(3, '0')}`,
  })) as ChangeRecord[];
}

/**
 * Fallback strategy: Per-pair comparison for large documents (>50 pages).
 * Sends both files + specific pair instructions for each mapping entry.
 */
async function comparePerPairFallback(
  ctx: WorkflowContext,
  mappingTable: MappingTable,
  filesData: any[],
): Promise<ChangeRecord[]> {
  const { logger } = ctx;
  const v1Sections = flattenSections(mappingTable.v1Outline.sections);
  const v2Sections = flattenSections(mappingTable.v2Outline.sections);
  const v1Map = new Map(v1Sections.map(s => [s.id, s]));
  const v2Map = new Map(v2Sections.map(s => [s.id, s]));

  const entriesToCompare = mappingTable.entries.filter(e => e.matchType !== 'SAME');
  const allChangeRecords: ChangeRecord[] = [];
  let globalChangeIndex = 1;

  for (let i = 0; i < entriesToCompare.length; i++) {
    const entry = entriesToCompare[i];

    const v1Content = assembleContent(entry.v1Sections, v1Map);
    const v2Content = assembleContent(entry.v2Sections, v2Map);
    const v1Identifier = entry.v1Sections.map(id => v1Map.get(id)?.identifier || id).join(' + ');
    const v2Identifier = entry.v2Sections.map(id => v2Map.get(id)?.identifier || id).join(' + ');

    if (v1Content.length === 0 && v2Content.length === 0) continue;

    const codePrefix = `CR-${String(globalChangeIndex).padStart(3, '0')}`;
    const comparisonInput: SectionComparisonInput = {
      mappingEntryId: entry.id,
      matchType: entry.matchType,
      v1Identifier,
      v2Identifier,
      v1Content,
      v2Content,
      codePrefix,
    };

    const prompt = buildSectionComparisonPrompt(comparisonInput, ctx.promptOverrides.section_comparison);

    try {
      // Send both files for visual reference + text content in prompt
      const bothFilesJson = JSON.stringify(filesData.slice(0, 2));
      const result = await enqueueSubStep(ctx, 'ext-comparator', prompt, bothFilesJson, ctx.modelOverrides.section_comparison, ctx.reasoningEffortOverrides.section_comparison);

      const records = parseSectionComparisonResult(
        result.content, entry.id, entry.v1Sections[0] || '', entry.v2Sections[0] || '',
      );

      for (const record of records) {
        record.code = `CR-${String(globalChangeIndex).padStart(3, '0')}`;
        globalChangeIndex++;
        allChangeRecords.push(record as ChangeRecord);
      }

      logger.info(`[STRUCTURE-COMPARE] Step 4 Pair ${i + 1}/${entriesToCompare.length}: ${records.length} changes`);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`[STRUCTURE-COMPARE] Step 4 Comparison failed for ${entry.id}: ${errMsg}`);
      allChangeRecords.push({
        code: `CR-${String(globalChangeIndex).padStart(3, '0')}`,
        severity: 'STRUCTURAL',
        mappingEntryId: entry.id,
        v1SectionId: entry.v1Sections[0] || '',
        v2SectionId: entry.v2Sections[0] || '',
        description: `Lỗi so sánh: ${errMsg}`,
        v1Quote: '(lỗi)',
        v2Quote: '(lỗi)',
        category: 'error',
      });
      globalChangeIndex++;
    }

    const pairProgress = stepProgress(3, 'start') +
      ((i + 1) / entriesToCompare.length) * (stepProgress(3, 'end') - stepProgress(3, 'start'));
    await updateProgress(ctx, Math.round(pairProgress), `Bước 4: Đã so sánh ${i + 1}/${entriesToCompare.length} cặp...`);
  }

  return allChangeRecords;
}

/**
 * Assemble content from one or more section IDs.
 * For SPLIT mappings (multiple V2 sections), concatenates all V2 content.
 * For MERGED mappings (multiple V1 sections), concatenates all V1 content.
 * Sections are joined with a double newline separator.
 */
function assembleContent(
  sectionIds: string[],
  sectionMap: Map<string, OutlineSection>,
): string {
  return sectionIds
    .map((id) => sectionMap.get(id)?.content || '')
    .filter((content) => content.length > 0)
    .join('\n\n');
}

// ─── Main Workflow ────────────────────────────────────────────────────────────

/**
 * Entry point registered in WORKFLOW_REGISTRY.
 * Orchestrates: Ingest → Structure Extraction → Auto-Mapping → [PAUSE] → Per-pair Comparison → Report.
 */
export async function runStructureCompare(ctx: WorkflowContext): Promise<void> {
  const resumeFromStep = ctx.currentStep;

  // ── STEP 1: Document Ingestion (parallel OCR) ─────────────────────────────
  if (resumeFromStep <= 0) {
    await stepIngest(ctx);
  }

  // ── STEP 2: Structure Extraction ──────────────────────────────────────────
  if (resumeFromStep <= 1) {
    await stepStructureExtraction(ctx);
  }

  // ── STEP 3: Auto-Mapping + PAUSE ──────────────────────────────────────────
  if (resumeFromStep <= 2) {
    await stepAutoMapping(ctx);
    return; // Workflow pauses here — resumed via POST /api/v1/operations/:id/resume
  }

  // ── STEP 4: Full Comparison (Phase 2 — after resume) ────────────────────
  if (resumeFromStep <= 3) {
    await stepFullComparison(ctx);
  }

  // ── STEP 5: Report Aggregation ────────────────────────────────────────────
  if (resumeFromStep <= 4) {
    await stepReportAggregation(ctx);
  }

  // ── COMPLETE: Mark workflow as SUCCEEDED ───────────────────────────────────
  const reportStep = ctx.stepsResult.find((s) => s.step === 4);
  const finalReport = reportStep?.extracted_data
    ? JSON.stringify(reportStep.extracted_data)
    : null;
  await completeWorkflow(ctx, finalReport, reportStep?.extracted_data ?? null);
}

// ─── Step 5: Report Aggregation ───────────────────────────────────────────────

/**
 * Step 5: Report Aggregation.
 * Calls report-aggregator to produce the final ComparisonReport from all
 * per-pair ChangeRecords. Stores the report in stepsResultJson step 4.
 * Sets the operation state to SUCCEEDED.
 */
async function stepReportAggregation(ctx: WorkflowContext): Promise<void> {
  const { logger } = ctx;

  logger.info(
    `[STRUCTURE-COMPARE] Step 5/${TOTAL_STEPS}: Aggregating comparison report`,
  );
  await updateProgress(
    ctx,
    stepProgress(4, 'start'),
    `Bước 5/${TOTAL_STEPS}: Đang tổng hợp báo cáo so sánh...`,
  );

  // Get ChangeRecords from step 3
  const comparisonStep = ctx.stepsResult.find((s) => s.step === 3);
  if (!comparisonStep || !comparisonStep.extracted_data) {
    throw new Error(
      'Không tìm thấy kết quả so sánh (Step 4). Vui lòng chạy lại workflow.',
    );
  }

  const changeRecords = comparisonStep.extracted_data as ChangeRecord[];

  // Get the confirmed MappingTable from step 2
  const mappingStep = ctx.stepsResult.find((s) => s.step === 2);
  if (!mappingStep || !mappingStep.extracted_data) {
    throw new Error(
      'Không tìm thấy bảng mapping (Step 3). Vui lòng chạy lại workflow.',
    );
  }

  const mappingTable = mappingStep.extracted_data as MappingTable;

  // Aggregate into final report
  const report = aggregateReport(changeRecords, mappingTable);

  logger.info(
    `[STRUCTURE-COMPARE] Step 5 Report complete: ${report.totalChanges} changes, ` +
    `severity breakdown: ${JSON.stringify(report.changesBySeverity)}`,
  );

  // Store step 4 results (final report)
  ctx.stepsResult.push({
    step: 4,
    stepName: 'Report Aggregation',
    processor: 'report-aggregator',
    content_preview: JSON.stringify({
      totalChanges: report.totalChanges,
      changesBySeverity: report.changesBySeverity,
      summary: report.summary,
    }),
    extracted_data: report,
  });

  await updateProgress(
    ctx,
    stepProgress(4, 'end'),
    `Bước 5 hoàn tất. ${report.summary}`,
  );
}
