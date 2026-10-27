// app/structure-compare/types.ts
// Frontend-specific types for the Structure-Mapped Comparison UI.

import type {
  DocumentOutline,
  MappingTable,
  ComparisonReport,
  MatchType,
} from '@/lib/structure-compare/types';

// Re-export shared types for convenience
export type { DocumentOutline, MappingTable, ComparisonReport, MatchType };
export type {
  OutlineSection,
  MappingEntry,
  ChangeRecord,
} from '@/lib/structure-compare/types';

// ─── Pipeline Step Types ─────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

/** Phases of the structure-mapped comparison pipeline */
export type PipelinePhase =
  | 'UPLOAD'
  | 'EXTRACTING'
  | 'MAPPING'
  | 'REVIEWING'
  | 'COMPARING'
  | 'REPORT';

export interface PipelineStep {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accentColor: string;
  status: StepStatus;
  progress: number;
  output: string | null;
  duration: number | null;
}

// ─── Upload Types ────────────────────────────────────────────────────────────

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  icon: string;
}

export interface DocumentPair {
  v1: UploadedFile | null;
  v2: UploadedFile | null;
}

// ─── Page State ──────────────────────────────────────────────────────────────

export interface StructureCompareState {
  /** Current phase of the pipeline */
  phase: PipelinePhase;
  /** Operation ID from the workflows API */
  operationId: string | null;
  /** Uploaded document pair */
  documents: DocumentPair;
  /** Extracted outlines (available after EXTRACTING phase) */
  v1Outline: DocumentOutline | null;
  v2Outline: DocumentOutline | null;
  /** Mapping table (available after MAPPING phase) */
  mappingTable: MappingTable | null;
  /** Final comparison report (available after REPORT phase) */
  report: ComparisonReport | null;
  /** Error message if any step fails */
  error: string | null;
  /** Whether the pipeline is currently polling for status */
  isPolling: boolean;
}

// ─── Component Props ─────────────────────────────────────────────────────────

export interface MappingEditorProps {
  mappingTable: MappingTable;
  onConfirm: (confirmedTable: MappingTable) => void;
  onAutoRemap: () => void;
  onUnmatch: (entryId: string) => void;
  onReassign: (
    sectionId: string,
    fromEntryId: string,
    toEntryId: string
  ) => void;
}

export interface OutlineViewerProps {
  outline: DocumentOutline;
  /** Section IDs to highlight (e.g., selected or hovered) */
  highlightedSections?: string[];
  onSectionClick?: (sectionId: string) => void;
}

export interface MappingLineProps {
  /** Source element position (left column) */
  from: { x: number; y: number };
  /** Target element position (right column) */
  to: { x: number; y: number };
  matchType: MatchType;
  isHighlighted?: boolean;
}

export interface ComparisonReportProps {
  report: ComparisonReport;
  v1FileName: string;
  v2FileName: string;
  mappingTable: import('@/lib/structure-compare/types').MappingTable | null;
}

export interface PipelineStepCardProps {
  step: PipelineStep;
  isActive: boolean;
}

// ─── Match Type Color Map ────────────────────────────────────────────────────

/** Color coding for match types as specified in requirements */
export const MATCH_TYPE_COLORS: Record<MatchType, string> = {
  SAME: 'green',
  RENUMBERED: 'blue',
  CHANGED: 'yellow',
  NEW: 'red',
  DELETED: 'red',
  SPLIT: 'purple',
  MERGED: 'purple',
  MOVED: 'orange',
};
