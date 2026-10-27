/**
 * Unit tests for the report aggregator module.
 *
 * Tests aggregation of ChangeRecords into ComparisonReport,
 * ordering by V1 structure position, severity counting, and summary generation.
 */
import { aggregateReport } from '@/lib/structure-compare/report-aggregator';
import type {
  ChangeRecord,
  ComparisonReport,
  DocumentOutline,
  MappingTable,
  OutlineSection,
} from '@/lib/structure-compare/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSection(overrides: Partial<OutlineSection> = {}): OutlineSection {
  return {
    id: overrides.id ?? 'sec-1',
    identifier: overrides.identifier ?? 'Điều 1',
    title: overrides.title ?? 'Phạm vi điều chỉnh',
    level: overrides.level ?? 1,
    startPos: overrides.startPos ?? 0,
    endPos: overrides.endPos ?? 100,
    content: overrides.content ?? 'Nội dung mẫu.',
    children: overrides.children,
  };
}

function makeOutline(
  sections: OutlineSection[],
  overrides: Partial<DocumentOutline> = {},
): DocumentOutline {
  return {
    documentId: overrides.documentId ?? 'doc-1',
    documentName: overrides.documentName ?? 'Document 1',
    sections,
    confidence: overrides.confidence ?? 90,
    isUncertain: overrides.isUncertain ?? false,
    source: overrides.source ?? 'ai_extracted',
  };
}

function makeMappingTable(
  v1Sections: OutlineSection[],
  v2Sections: OutlineSection[] = [],
): MappingTable {
  return {
    sessionId: 'session-test',
    entries: [],
    v1Outline: makeOutline(v1Sections, { documentId: 'doc-v1' }),
    v2Outline: makeOutline(v2Sections, { documentId: 'doc-v2' }),
    autoMappedPercentage: 80,
    isLocked: true,
  };
}

function makeChangeRecord(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    code: overrides.code ?? 'CR-001',
    severity: overrides.severity ?? 'MODERATE',
    mappingEntryId: overrides.mappingEntryId ?? 'map-0-0',
    v1SectionId: overrides.v1SectionId ?? 'v1-sec-1',
    v2SectionId: overrides.v2SectionId ?? 'v2-sec-1',
    description: overrides.description ?? 'Thay đổi nội dung điều khoản.',
    v1Quote: overrides.v1Quote ?? 'Nội dung gốc từ V1.',
    v2Quote: overrides.v2Quote ?? 'Nội dung mới từ V2.',
    category: overrides.category,
  };
}

// ─── aggregateReport Tests ───────────────────────────────────────────────────

describe('aggregateReport', () => {
  it('returns empty report for no changes', () => {
    const mappingTable = makeMappingTable([]);
    const result = aggregateReport([], mappingTable);

    expect(result.sessionId).toBe('session-test');
    expect(result.totalChanges).toBe(0);
    expect(result.changes).toHaveLength(0);
    expect(result.changesBySeverity).toEqual({});
    expect(result.generatedAt).toBeDefined();
  });

  it('counts totalChanges correctly', () => {
    const v1Sections = [
      makeSection({ id: 'v1-sec-1', startPos: 0 }),
      makeSection({ id: 'v1-sec-2', startPos: 100 }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-sec-2' }),
      makeChangeRecord({ code: 'CR-003', v1SectionId: 'v1-sec-1' }),
    ];

    const result = aggregateReport(changes, mappingTable);
    expect(result.totalChanges).toBe(3);
  });

  it('orders changes by V1 section startPos (ascending)', () => {
    const v1Sections = [
      makeSection({ id: 'v1-sec-1', startPos: 500 }),
      makeSection({ id: 'v1-sec-2', startPos: 100 }),
      makeSection({ id: 'v1-sec-3', startPos: 300 }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'v1-sec-1' }), // startPos 500
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-sec-2' }), // startPos 100
      makeChangeRecord({ code: 'CR-003', v1SectionId: 'v1-sec-3' }), // startPos 300
    ];

    const result = aggregateReport(changes, mappingTable);

    expect(result.changes[0].code).toBe('CR-002'); // startPos 100
    expect(result.changes[1].code).toBe('CR-003'); // startPos 300
    expect(result.changes[2].code).toBe('CR-001'); // startPos 500
  });

  it('handles nested sections for position lookup', () => {
    const v1Sections = [
      makeSection({
        id: 'v1-parent',
        startPos: 0,
        children: [
          makeSection({ id: 'v1-child-1', startPos: 50 }),
          makeSection({ id: 'v1-child-2', startPos: 200 }),
        ],
      }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'v1-child-2' }), // startPos 200
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-child-1' }), // startPos 50
    ];

    const result = aggregateReport(changes, mappingTable);

    expect(result.changes[0].code).toBe('CR-002'); // startPos 50
    expect(result.changes[1].code).toBe('CR-001'); // startPos 200
  });

  it('counts changes by severity correctly', () => {
    const v1Sections = [makeSection({ id: 'v1-sec-1', startPos: 0 })];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', severity: 'CRITICAL', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-002', severity: 'CRITICAL', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-003', severity: 'MAJOR', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-004', severity: 'MINOR', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-005', severity: 'STRUCTURAL', v1SectionId: 'v1-sec-1' }),
    ];

    const result = aggregateReport(changes, mappingTable);

    expect(result.changesBySeverity).toEqual({
      CRITICAL: 2,
      MAJOR: 1,
      MINOR: 1,
      STRUCTURAL: 1,
    });
  });

  it('generates summary for zero changes', () => {
    const mappingTable = makeMappingTable([]);
    const result = aggregateReport([], mappingTable);

    expect(result.summary).toContain('Không phát hiện thay đổi');
  });

  it('generates summary with severity breakdown', () => {
    const v1Sections = [makeSection({ id: 'v1-sec-1', startPos: 0 })];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', severity: 'CRITICAL', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-002', severity: 'MAJOR', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-003', severity: 'MINOR', v1SectionId: 'v1-sec-1' }),
    ];

    const result = aggregateReport(changes, mappingTable);

    expect(result.summary).toContain('3 thay đổi');
    expect(result.summary).toContain('nghiêm trọng');
    expect(result.summary).toContain('quan trọng');
    expect(result.summary).toContain('nhỏ');
  });

  it('uses sessionId from mapping table', () => {
    const mappingTable = makeMappingTable([]);
    const result = aggregateReport([], mappingTable);
    expect(result.sessionId).toBe('session-test');
  });

  it('sets generatedAt to a valid ISO 8601 timestamp', () => {
    const mappingTable = makeMappingTable([]);
    const result = aggregateReport([], mappingTable);

    // Should be a valid ISO date string
    const parsed = new Date(result.generatedAt);
    expect(parsed.toISOString()).toBe(result.generatedAt);
  });

  it('does not mutate the original changes array', () => {
    const v1Sections = [
      makeSection({ id: 'v1-sec-1', startPos: 500 }),
      makeSection({ id: 'v1-sec-2', startPos: 100 }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'v1-sec-1' }),
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-sec-2' }),
    ];

    const originalOrder = changes.map((c) => c.code);
    aggregateReport(changes, mappingTable);

    // Original array should not be modified
    expect(changes.map((c) => c.code)).toEqual(originalOrder);
  });

  it('places changes with unknown v1SectionId at the end', () => {
    const v1Sections = [
      makeSection({ id: 'v1-sec-1', startPos: 100 }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'unknown-id' }),
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-sec-1' }),
    ];

    const result = aggregateReport(changes, mappingTable);

    // Known section should come first, unknown at end
    expect(result.changes[0].code).toBe('CR-002');
    expect(result.changes[1].code).toBe('CR-001');
  });

  it('handles multiple changes for the same section', () => {
    const v1Sections = [
      makeSection({ id: 'v1-sec-1', startPos: 0 }),
      makeSection({ id: 'v1-sec-2', startPos: 200 }),
    ];
    const mappingTable = makeMappingTable(v1Sections);

    const changes = [
      makeChangeRecord({ code: 'CR-001', v1SectionId: 'v1-sec-2', severity: 'CRITICAL' }),
      makeChangeRecord({ code: 'CR-002', v1SectionId: 'v1-sec-1', severity: 'MINOR' }),
      makeChangeRecord({ code: 'CR-003', v1SectionId: 'v1-sec-1', severity: 'MAJOR' }),
      makeChangeRecord({ code: 'CR-004', v1SectionId: 'v1-sec-2', severity: 'MODERATE' }),
    ];

    const result = aggregateReport(changes, mappingTable);

    // Section 1 changes (startPos 0) should come before section 2 (startPos 200)
    expect(result.changes[0].v1SectionId).toBe('v1-sec-1');
    expect(result.changes[1].v1SectionId).toBe('v1-sec-1');
    expect(result.changes[2].v1SectionId).toBe('v1-sec-2');
    expect(result.changes[3].v1SectionId).toBe('v1-sec-2');
  });
});
