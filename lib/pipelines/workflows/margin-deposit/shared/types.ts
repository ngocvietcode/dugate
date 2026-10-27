// lib/pipelines/workflows/margin-deposit/shared/types.ts
// Structural types shared across all margin-deposit modes.
// Mirrors payment-account-management/shared/types.ts.

/**
 * Supported margin-deposit modes. Each maps to a runner in ../index.ts MODE_REGISTRY.
 * - classify   → phân loại chứng từ, không cần doc_type, cho phép multi-doc-per-file
 * - extraction → bóc tách dữ liệu, client đã biết doc_type
 * - framework  → đối chiếu chứng từ khách hàng với chứng từ khung theo doc_type
 * - validation → đối chiếu N bản sao (copy-check) + đối chiếu khung (template-check)
 */
export type MarginMode = 'classify' | 'extraction' | 'framework' | 'validation';

export const MARGIN_MODES: readonly MarginMode[] = ['classify', 'extraction', 'framework', 'validation'] as const;

/**
 * A file's role within a request. Only meaningful for `framework` and `validation`,
 * where both a document-to-check ("customer") and a document-to-check-against
 * ("template") can appear in the SAME `files[]` array. Defaults to 'customer' when
 * omitted. `classify` and `extraction` ignore this field entirely.
 */
export type FileRole = 'customer' | 'template';

export const FILE_ROLES: readonly FileRole[] = ['customer', 'template'] as const;

/**
 * One entry of the Option-A index-aligned `metadata.file_meta[]` array.
 * `doc_type` must be one of the 7 known ESCROW_DOCUMENT_CODES.
 * `role` is optional; resolved to 'customer' by parseFileMetaArray() when omitted.
 * `group_id` is required only for `role: customer` entries whose `doc_type` is
 * `thoa_thuan_ky_quy` or `thanh_ly_ky_quy` in `validation` mode.
 */
export interface FileMetaEntry {
  doc_type: string;
  role?: FileRole;
  group_id?: string;
}

/**
 * Shared raw metadata type accepted by every mode runner (parsed from
 * `pipelineVars.metadata` by `parseRawMetadata()`). All four runners share
 * this exact type — mirroring payment-account-management's single
 * `PamMetadata` parameter — so `MODE_REGISTRY` dispatch type-checks without
 * per-mode narrowing. Each runner reads only the fields it needs (e.g.
 * `metadata.file_meta`) and validates them itself via `parseFileMetaArray()`.
 */
export type MarginMetadata = Record<string, unknown>;

/** @deprecated Use `MarginMetadata` — kept as aliases for call-site readability. */
export type ClassifyMetadata = MarginMetadata;
/** @deprecated Use `MarginMetadata` — kept as aliases for call-site readability. */
export type ExtractionMetadata = MarginMetadata;
/** @deprecated Use `MarginMetadata` — kept as aliases for call-site readability. */
export type FrameworkMetadata = MarginMetadata;
/** @deprecated Use `MarginMetadata` — kept as aliases for call-site readability. */
export type ValidationMetadata = MarginMetadata;
