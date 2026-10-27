// lib/pipelines/workflows/margin-deposit/shared/file-meta.ts
// Option-A index-aligned file-metadata contract, shared by extraction/framework/validation.
//
// There is only ONE file-array field (`files[]`) across every margin-deposit mode.
// `framework` and `validation` distinguish customer vs. template files via
// `metadata.file_meta[].role` rather than a second file-array field, because the
// shared `normalizeFiles()` layer (lib/endpoints/runner.ts, used by every DUGate
// service) only collects one file array per request. This module deliberately
// avoids modifying that shared layer.

import type { WorkflowContext } from '@/lib/pipelines/workflow-engine';
import { ESCROW_DOCUMENT_CODES } from '../../prompts/margin-deposit-profile-prompts';
import { FILE_ROLES, type FileMetaEntry, type FileRole } from './types';

const KNOWN_CODES = new Set<string>(ESCROW_DOCUMENT_CODES);
const KNOWN_ROLES = new Set<FileRole>(FILE_ROLES);

export interface ParsedFileGroup {
  file: WorkflowContext['filesData'][number];
  /** `role` is always resolved (never undefined) after parsing — defaults to 'customer'. */
  meta: FileMetaEntry & { role: FileRole };
  /** Stable per-file identity for this request, derived from the file's index. */
  file_id: string;
}

export interface ParseFileMetaOptions {
  /**
   * doc_type codes for which a `role: customer` entry MUST also carry `group_id`.
   * Only enforced against entries whose resolved `role` is 'customer'; `role:
   * template` entries never require `group_id` even if their `doc_type` matches.
   */
  requireGroupIdForCodes?: readonly string[];
  /**
   * Upper bound on how many `role: template` files are allowed per doc_type.
   * Only template entries are counted (customer files are unrestricted). Used by
   * framework/validation to cap, e.g. Đơn tra soát at 2 distinct templates.
   * Example: { don_tra_soat: 2 }. Exceeding the cap throws INVALID_INPUT.
   */
  maxTemplatesPerDocType?: Readonly<Record<string, number>>;
}

function fileIdFor(file: WorkflowContext['filesData'][number], index: number): string {
  const explicit = file.file_id?.trim();
  if (explicit) return explicit;
  return `input-${String(index + 1).padStart(3, '0')}::${file.name}`;
}

function parseRawMetaArray(rawMeta: unknown): unknown[] {
  if (rawMeta === undefined || rawMeta === null || rawMeta === '') {
    throw new Error('INVALID_INPUT: metadata.file_meta is required and must be a JSON array.');
  }
  let value: unknown = rawMeta;
  if (typeof rawMeta === 'string') {
    try {
      value = JSON.parse(rawMeta);
    } catch {
      throw new Error('INVALID_INPUT: metadata.file_meta must be valid JSON.');
    }
  }
  if (!Array.isArray(value)) {
    throw new Error('INVALID_INPUT: metadata.file_meta must be a JSON array.');
  }
  return value;
}

/**
 * Validates that `files.length === rawMeta.length`, that `rawMeta` parses as an
 * array of well-formed entries, that every `doc_type` is a known taxonomy code,
 * and that `role` (if present) is 'customer' or 'template'. Resolves a missing
 * `role` to 'customer'. Throws INVALID_INPUT identifying the offending index on
 * any failure. Never attempts partial/best-effort alignment: either the whole
 * request is rejected before any file is touched, or every entry is valid.
 */
export function parseFileMetaArray(
  files: WorkflowContext['filesData'],
  rawMeta: unknown,
  options: ParseFileMetaOptions = {},
): ParsedFileGroup[] {
  const parsed = parseRawMetaArray(rawMeta);

  if (parsed.length !== files.length) {
    throw new Error(
      `INVALID_INPUT: metadata.file_meta length (${parsed.length}) does not match files length (${files.length}).`,
    );
  }

  const requireGroupIdForCodes = new Set(options.requireGroupIdForCodes ?? []);

  const groups = files.map((file, index) => {
    const rawEntry = parsed[index];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(`INVALID_INPUT: metadata.file_meta[${index}] must be an object.`);
    }
    const entry = rawEntry as Record<string, unknown>;

    const docType = typeof entry.doc_type === 'string' ? entry.doc_type.trim() : '';
    if (!KNOWN_CODES.has(docType)) {
      throw new Error(`INVALID_INPUT: metadata.file_meta[${index}].doc_type "${docType}" is not a known document type.`);
    }

    let role: FileRole = 'customer';
    if (entry.role !== undefined) {
      if (typeof entry.role !== 'string' || !KNOWN_ROLES.has(entry.role as FileRole)) {
        throw new Error(`INVALID_INPUT: metadata.file_meta[${index}].role must be "customer" or "template".`);
      }
      role = entry.role as FileRole;
    }

    const groupId = typeof entry.group_id === 'string' && entry.group_id.trim() ? entry.group_id.trim() : undefined;
    if (role === 'customer' && requireGroupIdForCodes.has(docType) && !groupId) {
      throw new Error(
        `INVALID_INPUT: metadata.file_meta[${index}] requires group_id for doc_type="${docType}".`,
      );
    }

    return {
      file,
      meta: { doc_type: docType, role, ...(groupId ? { group_id: groupId } : {}) },
      file_id: fileIdFor(file, index),
    };
  });

  // Enforce per-doc_type template caps (e.g. Đơn tra soát ≤ 2 templates). Only
  // `role: template` files count; customer files are unrestricted.
  const maxTemplates = options.maxTemplatesPerDocType;
  if (maxTemplates) {
    const templateCountByType = new Map<string, number>();
    for (const group of groups) {
      if (group.meta.role !== 'template') continue;
      templateCountByType.set(group.meta.doc_type, (templateCountByType.get(group.meta.doc_type) ?? 0) + 1);
    }
    for (const [docType, max] of Object.entries(maxTemplates)) {
      const count = templateCountByType.get(docType) ?? 0;
      if (count > max) {
        throw new Error(
          `INVALID_INPUT: too many template files for doc_type="${docType}" (received ${count}, max ${max}).`,
        );
      }
    }
  }

  return groups;
}
