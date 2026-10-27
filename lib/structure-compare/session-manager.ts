/**
 * Session Manager for Structure-Mapped Document Comparison.
 *
 * Handles:
 * 1. Serialization/deserialization of session state (outlines, mapping table, comparison results)
 * 2. Selective invalidation: when a MappingEntry changes, invalidate only affected ChangeRecords
 * 3. Determining which pairs need re-comparison after mapping changes
 *
 * The Comparison_Session maps to an Operation record with stepsResultJson
 * storing intermediate state. This module provides typed access to that state.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import type {
  DocumentOutline,
  MappingTable,
  MappingEntry,
  ChangeRecord,
  ComparisonReport,
} from './types';

// ─── Session State Types ─────────────────────────────────────────────────────

/**
 * The complete session state for a structure-mapped comparison.
 * Stored in the Operations table's stepsResultJson field.
 */
export interface ComparisonSessionState {
  /** Extracted outline for V1 document */
  v1Outline: DocumentOutline | null;
  /** Extracted outline for V2 document */
  v2Outline: DocumentOutline | null;
  /** Current mapping table (may be edited by user) */
  mappingTable: MappingTable | null;
  /** Per-pair comparison results (ChangeRecords) */
  changeRecords: ChangeRecord[] | null;
  /** Final aggregated report */
  report: ComparisonReport | null;
  /** Current workflow phase */
  phase: 'ingesting' | 'extracting' | 'mapping' | 'reviewing' | 'comparing' | 'completed' | 'failed';
  /** Notifications/warnings accumulated during processing */
  notifications: string[];
}

// ─── Serialization / Deserialization ─────────────────────────────────────────

/**
 * Extract the ComparisonSessionState from the stepsResultJson array.
 * This is the canonical way to read session state from the Operations table.
 */
export function deserializeSessionState(
  stepsResult: Record<string, unknown>[],
): ComparisonSessionState {
  const state: ComparisonSessionState = {
    v1Outline: null,
    v2Outline: null,
    mappingTable: null,
    changeRecords: null,
    report: null,
    phase: 'ingesting',
    notifications: [],
  };

  for (const step of stepsResult) {
    const stepNum = step.step as number;

    switch (stepNum) {
      case 0:
        // Ingest step — no outline data yet, but we're past ingesting
        state.phase = 'extracting';
        break;

      case 1: {
        // Structure extraction step
        const data = step.extracted_data as { v1Outline: DocumentOutline; v2Outline: DocumentOutline } | undefined;
        if (data) {
          state.v1Outline = data.v1Outline;
          state.v2Outline = data.v2Outline;
        }
        state.phase = 'mapping';
        break;
      }

      case 2: {
        // Auto-mapping step
        const mappingTable = step.extracted_data as MappingTable | undefined;
        if (mappingTable) {
          state.mappingTable = mappingTable;
        }
        // If there's a warning, add to notifications
        if (step.warning && typeof step.warning === 'string') {
          state.notifications.push(step.warning);
        }
        state.phase = 'reviewing';
        break;
      }

      case 3: {
        // Per-pair comparison step
        const records = step.extracted_data as ChangeRecord[] | undefined;
        if (records) {
          state.changeRecords = records;
        }
        state.phase = 'comparing';
        break;
      }

      case 4: {
        // Report aggregation step
        const report = step.extracted_data as ComparisonReport | undefined;
        if (report) {
          state.report = report;
        }
        state.phase = 'completed';
        break;
      }
    }
  }

  return state;
}

/**
 * Serialize a ComparisonSessionState back into the stepsResultJson format.
 * Used when the session state needs to be persisted after modifications
 * (e.g., after selective invalidation).
 */
export function serializeSessionState(
  state: ComparisonSessionState,
  existingStepsResult: Record<string, unknown>[],
): Record<string, unknown>[] {
  const result = [...existingStepsResult];

  // Update step 2 (mapping table) if it exists and has been modified
  if (state.mappingTable) {
    const mappingStepIdx = result.findIndex((s) => s.step === 2);
    if (mappingStepIdx >= 0) {
      result[mappingStepIdx] = {
        ...result[mappingStepIdx],
        extracted_data: state.mappingTable,
      };
    }
  }

  // Update step 3 (change records) if it exists and has been modified
  if (state.changeRecords) {
    const comparisonStepIdx = result.findIndex((s) => s.step === 3);
    if (comparisonStepIdx >= 0) {
      result[comparisonStepIdx] = {
        ...result[comparisonStepIdx],
        extracted_data: state.changeRecords,
      };
    }
  }

  // Update step 4 (report) if it exists and has been modified
  if (state.report) {
    const reportStepIdx = result.findIndex((s) => s.step === 4);
    if (reportStepIdx >= 0) {
      result[reportStepIdx] = {
        ...result[reportStepIdx],
        extracted_data: state.report,
      };
    }
  }

  return result;
}

// ─── Selective Invalidation ──────────────────────────────────────────────────

/**
 * Identify which MappingEntries have changed between the old and new mapping tables.
 * Returns the IDs of entries that were added, removed, or modified.
 */
export function findChangedEntries(
  oldTable: MappingTable,
  newTable: MappingTable,
): Set<string> {
  const changedIds = new Set<string>();

  const oldMap = new Map(oldTable.entries.map((e) => [e.id, e]));
  const newMap = new Map(newTable.entries.map((e) => [e.id, e]));

  // Find removed entries
  oldMap.forEach((_, id) => {
    if (!newMap.has(id)) {
      changedIds.add(id);
    }
  });

  // Find added entries
  newMap.forEach((_, id) => {
    if (!oldMap.has(id)) {
      changedIds.add(id);
    }
  });

  // Find modified entries (same ID but different content)
  newMap.forEach((newEntry, id) => {
    const oldEntry = oldMap.get(id);
    if (oldEntry && !entriesEqual(oldEntry, newEntry)) {
      changedIds.add(id);
    }
  });

  return changedIds;
}

/**
 * Check if two MappingEntries are semantically equal.
 */
function entriesEqual(a: MappingEntry, b: MappingEntry): boolean {
  return (
    a.matchType === b.matchType &&
    arraysEqual(a.v1Sections, b.v1Sections) &&
    arraysEqual(a.v2Sections, b.v2Sections)
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Selectively invalidate comparison results for changed mapping entries.
 *
 * Given an old mapping table, a new mapping table, and existing ChangeRecords,
 * removes only the ChangeRecords that reference changed/removed entries.
 * Returns the filtered ChangeRecords and the set of entry IDs that need re-comparison.
 *
 * Requirements: 5.5 — "invalidate previous comparison results for affected pairs
 * and re-compare only those pairs"
 */
export function selectiveInvalidation(
  oldTable: MappingTable,
  newTable: MappingTable,
  existingRecords: ChangeRecord[],
): {
  /** ChangeRecords that are still valid (unaffected by mapping changes) */
  validRecords: ChangeRecord[];
  /** Entry IDs that need re-comparison */
  entriesToRecompare: string[];
  /** Section IDs from both V1 and V2 that are affected */
  affectedSectionIds: Set<string>;
} {
  const changedEntryIds = findChangedEntries(oldTable, newTable);

  // Also find entries that reference sections involved in changed entries
  const affectedSectionIds = new Set<string>();
  changedEntryIds.forEach((id) => {
    const oldEntry = oldTable.entries.find((e) => e.id === id);
    const newEntry = newTable.entries.find((e) => e.id === id);

    if (oldEntry) {
      oldEntry.v1Sections.forEach((s) => affectedSectionIds.add(s));
      oldEntry.v2Sections.forEach((s) => affectedSectionIds.add(s));
    }
    if (newEntry) {
      newEntry.v1Sections.forEach((s) => affectedSectionIds.add(s));
      newEntry.v2Sections.forEach((s) => affectedSectionIds.add(s));
    }
  });

  // Filter out ChangeRecords that reference affected entries or sections
  const validRecords = existingRecords.filter((record) => {
    // Remove if the record's mapping entry was changed
    if (changedEntryIds.has(record.mappingEntryId)) return false;

    // Remove if the record references an affected section
    if (affectedSectionIds.has(record.v1SectionId)) return false;
    if (affectedSectionIds.has(record.v2SectionId)) return false;

    return true;
  });

  // Determine which new entries need comparison
  const entriesToRecompare = newTable.entries
    .filter((entry) => {
      // New entries always need comparison
      if (changedEntryIds.has(entry.id)) return true;

      // Entries referencing affected sections need re-comparison
      const hasAffectedV1 = entry.v1Sections.some((s) => affectedSectionIds.has(s));
      const hasAffectedV2 = entry.v2Sections.some((s) => affectedSectionIds.has(s));
      return hasAffectedV1 || hasAffectedV2;
    })
    .filter((entry) => entry.matchType !== 'SAME') // Skip SAME entries
    .map((entry) => entry.id);

  return { validRecords, entriesToRecompare, affectedSectionIds };
}

/**
 * Apply a mapping table update to the session state.
 * Invalidates affected comparison results and marks the session
 * as needing partial re-comparison.
 *
 * Returns the updated state with invalidated results removed.
 */
export function applyMappingUpdate(
  state: ComparisonSessionState,
  newMappingTable: MappingTable,
): ComparisonSessionState {
  const updatedState = { ...state };
  const oldTable = state.mappingTable;

  updatedState.mappingTable = newMappingTable;

  // If there are existing comparison results, selectively invalidate
  if (oldTable && state.changeRecords && state.changeRecords.length > 0) {
    const { validRecords } = selectiveInvalidation(
      oldTable,
      newMappingTable,
      state.changeRecords,
    );
    updatedState.changeRecords = validRecords;
    // Invalidate the report since it's based on old results
    updatedState.report = null;
    updatedState.phase = 'reviewing';
  } else {
    updatedState.phase = 'reviewing';
  }

  return updatedState;
}
