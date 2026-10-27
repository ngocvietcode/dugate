/**
 * Report Aggregator for Structure-Mapped Document Comparison.
 *
 * Aggregates per-pair ChangeRecords into a single ComparisonReport:
 * 1. Orders changes by V1 document structure position (startPos of V1 section)
 * 2. Calculates totalChanges and changesBySeverity summary
 * 3. Generates a human-readable report summary
 *
 * Requirements: 4.5, 4.6, 4.7
 */

import type {
  ChangeRecord,
  ComparisonReport,
  MappingTable,
  OutlineSection,
} from './types';
import { flattenSections } from './section-mapper';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a lookup map from section ID → startPos using the V1 outline.
 * Flattens the hierarchical section tree for O(1) lookups.
 */
function buildV1PositionMap(mappingTable: MappingTable): Map<string, number> {
  const positionMap = new Map<string, number>();
  const flatSections = flattenSections(mappingTable.v1Outline.sections);
  for (const section of flatSections) {
    positionMap.set(section.id, section.startPos);
  }
  return positionMap;
}

/**
 * Get the V1 section start position for a given change record.
 * Uses the mapping table's V1 outline to look up the position.
 * Returns Infinity for records with no V1 section (e.g., NEW sections)
 * so they sort to the end.
 */
function getV1StartPos(
  change: ChangeRecord,
  positionMap: Map<string, number>,
): number {
  if (!change.v1SectionId) return Infinity;
  return positionMap.get(change.v1SectionId) ?? Infinity;
}

/**
 * Count changes grouped by severity level.
 */
function countBySeverity(changes: ChangeRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const change of changes) {
    counts[change.severity] = (counts[change.severity] ?? 0) + 1;
  }
  return counts;
}

/**
 * Generate a human-readable summary of the comparison results.
 */
function generateSummary(
  totalChanges: number,
  changesBySeverity: Record<string, number>,
): string {
  if (totalChanges === 0) {
    return 'Không phát hiện thay đổi giữa hai phiên bản tài liệu.';
  }

  const parts: string[] = [];
  parts.push(`Phát hiện ${totalChanges} thay đổi`);

  const severityLabels: Record<string, string> = {
    CRITICAL: 'nghiêm trọng',
    MAJOR: 'quan trọng',
    MODERATE: 'trung bình',
    MINOR: 'nhỏ',
    STRUCTURAL: 'cấu trúc',
  };

  const details: string[] = [];
  // Order severity from most to least severe
  const severityOrder = ['CRITICAL', 'MAJOR', 'MODERATE', 'MINOR', 'STRUCTURAL'];
  for (const severity of severityOrder) {
    const count = changesBySeverity[severity];
    if (count && count > 0) {
      const label = severityLabels[severity] ?? severity.toLowerCase();
      details.push(`${count} ${label}`);
    }
  }

  if (details.length > 0) {
    parts.push(`: ${details.join(', ')}`);
  }

  parts.push('.');

  return parts.join('');
}

// ─── Main Aggregator Function ────────────────────────────────────────────────

/**
 * Aggregate per-pair ChangeRecords into a single ComparisonReport.
 *
 * @param changes - Array of ChangeRecord objects from per-pair comparisons
 * @param mappingTable - The MappingTable used to look up V1 section positions
 * @returns A complete ComparisonReport with changes ordered by V1 structure position
 */
export function aggregateReport(
  changes: ChangeRecord[],
  mappingTable: MappingTable,
): ComparisonReport {
  const positionMap = buildV1PositionMap(mappingTable);

  // Sort changes by V1 section startPos (ascending)
  const sortedChanges = [...changes].sort((a, b) => {
    const posA = getV1StartPos(a, positionMap);
    const posB = getV1StartPos(b, positionMap);
    return posA - posB;
  });

  const totalChanges = sortedChanges.length;
  const changesBySeverity = countBySeverity(sortedChanges);
  const summary = generateSummary(totalChanges, changesBySeverity);

  return {
    sessionId: mappingTable.sessionId,
    totalChanges,
    changesBySeverity,
    changes: sortedChanges,
    summary,
    generatedAt: new Date().toISOString(),
  };
}
