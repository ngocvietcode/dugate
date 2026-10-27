// lib/structure-compare/types.ts
// Shared types for the Structure-Mapped Document Comparison feature.
// Used by both backend pipeline logic and frontend components.

/**
 * Represents the hierarchical outline/structure extracted from a document.
 * Produced by the Structure_Extractor (AI or local heading parser).
 */
export interface DocumentOutline {
  documentId: string;
  documentName: string;
  sections: OutlineSection[];
  /** Overall extraction confidence score (0-100) */
  confidence: number;
  /** True if confidence < 60%, indicating the outline needs user confirmation */
  isUncertain: boolean;
  /** How the structure was determined */
  source: 'native_toc' | 'inferred' | 'ai_extracted';
}

/**
 * A single section within a document outline.
 * Represents a heading, article, clause, or other structural unit.
 */
export interface OutlineSection {
  /** Unique identifier within the document */
  id: string;
  /** Display identifier, e.g. "Điều 1", "1.2.3", "Section A" */
  identifier: string;
  /** Section title or first 15 words of content */
  title: string;
  /** Hierarchy depth (0 = root, 1 = H1, 2 = H2, etc.) */
  level: number;
  /** Character position start in the source document */
  startPos: number;
  /** Character position end in the source document */
  endPos: number;
  /** Full text content of this section */
  content: string;
  /** Nested sub-sections */
  children?: OutlineSection[];
  /** Per-section OCR confidence if applicable (0-100) */
  ocrConfidence?: number;
}

/**
 * Classification of how two sections relate between document versions.
 */
export type MatchType =
  | 'SAME'
  | 'RENUMBERED'
  | 'CHANGED'
  | 'NEW'
  | 'DELETED'
  | 'SPLIT'
  | 'MERGED'
  | 'MOVED';

/**
 * A single mapping entry pairing section(s) from V1 to section(s) from V2.
 */
export interface MappingEntry {
  id: string;
  /** Section IDs from V1 (1 for normal, multiple for MERGED) */
  v1Sections: string[];
  /** Section IDs from V2 (1 for normal, multiple for SPLIT) */
  v2Sections: string[];
  matchType: MatchType;
  /** Confidence score for this mapping (0-100) */
  confidenceScore: number;
  /** True if confidenceScore < 70, indicating the pair needs manual review */
  needsReview: boolean;
}

/**
 * The complete mapping table linking sections between two document versions.
 * Every section from both documents must appear in exactly one entry.
 */
export interface MappingTable {
  sessionId: string;
  entries: MappingEntry[];
  v1Outline: DocumentOutline;
  v2Outline: DocumentOutline;
  /** Percentage of sections successfully auto-mapped (0-100) */
  autoMappedPercentage: number;
  /** True after user confirms the mapping, preventing further edits */
  isLocked: boolean;
}


/**
 * A single change record produced by the Section_Comparator.
 * Represents one semantic difference between mapped section pairs.
 */
export interface ChangeRecord {
  /** Change code identifier, e.g. "CR-001" */
  code: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR' | 'STRUCTURAL';
  /** Reference to the MappingEntry that produced this change */
  mappingEntryId: string;
  /** Section ID from V1 involved in this change */
  v1SectionId: string;
  /** Section ID from V2 involved in this change */
  v2SectionId: string;
  /** Human-readable description of the change */
  description: string;
  /** Verbatim quote from V1 for traceability */
  v1Quote: string;
  /** Verbatim quote from V2 for traceability */
  v2Quote: string;
  /** Optional category for grouping changes */
  category?: string;
}

/**
 * The final aggregated comparison report for a structure-mapped comparison session.
 * Contains all change records ordered by V1 document structure position.
 */
export interface ComparisonReport {
  sessionId: string;
  totalChanges: number;
  /** Count of changes grouped by severity level */
  changesBySeverity: Record<string, number>;
  /** All change records, ordered by V1 structure position */
  changes: ChangeRecord[];
  /** Human-readable summary of the comparison results */
  summary: string;
  /** ISO 8601 timestamp of when the report was generated */
  generatedAt: string;
}
