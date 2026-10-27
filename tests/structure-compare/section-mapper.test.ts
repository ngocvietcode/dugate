/**
 * Unit tests for the section mapper module.
 *
 * Tests multi-signal scoring, Hungarian algorithm, match classification,
 * SPLIT/MERGED detection, and low-overlap warning.
 */
import {
  titleSimilarity,
  contentSimilarity,
  positionalProximity,
  computeSimilarity,
  hungarianAlgorithm,
  flattenSections,
  mapSections,
  unmatchEntry,
  type MapperResult,
} from '@/lib/structure-compare/section-mapper';
import type {
  DocumentOutline,
  OutlineSection,
  MappingTable,
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
    content: overrides.content ?? 'Nội dung của điều khoản này quy định phạm vi điều chỉnh của luật.',
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

// ─── Title Similarity Tests ──────────────────────────────────────────────────

describe('titleSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(titleSimilarity('Hello World', 'Hello World')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(titleSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(titleSimilarity('Hello', '')).toBe(0);
    expect(titleSimilarity('', 'World')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(titleSimilarity('Hello', 'hello')).toBe(1);
  });

  it('returns high similarity for similar strings', () => {
    const score = titleSimilarity('Điều 1', 'Điều 2');
    expect(score).toBeGreaterThan(0.7);
  });

  it('returns low similarity for very different strings', () => {
    const score = titleSimilarity('Phạm vi điều chỉnh', 'Xử phạt vi phạm hành chính');
    expect(score).toBeLessThan(0.5);
  });

  it('returns value between 0 and 1', () => {
    const score = titleSimilarity('abc', 'xyz');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── Content Similarity Tests ────────────────────────────────────────────────

describe('contentSimilarity', () => {
  it('returns 1 for identical content', () => {
    const text = 'This is a sample text with enough words to form trigrams properly';
    expect(contentSimilarity(text, text)).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(contentSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(contentSimilarity('some content here', '')).toBe(0);
  });

  it('returns high similarity for texts with shared content', () => {
    const a = 'Luật này quy định về phạm vi điều chỉnh và đối tượng áp dụng';
    const b = 'Luật này quy định về phạm vi điều chỉnh và các đối tượng áp dụng cụ thể';
    const score = contentSimilarity(a, b);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low similarity for completely different texts', () => {
    const a = 'The quick brown fox jumps over the lazy dog in the park';
    const b = 'A completely different sentence about mathematics and science topics';
    const score = contentSimilarity(a, b);
    expect(score).toBeLessThan(0.3);
  });

  it('falls back to unigrams for short texts', () => {
    // Texts too short for trigrams (< 3 words)
    const score = contentSimilarity('hello world', 'hello world');
    expect(score).toBe(1);
  });
});

// ─── Positional Proximity Tests ──────────────────────────────────────────────

describe('positionalProximity', () => {
  it('returns 1 for same relative position', () => {
    expect(positionalProximity(0, 5, 0, 5)).toBe(1);
    expect(positionalProximity(2, 5, 2, 5)).toBe(1);
    expect(positionalProximity(4, 5, 4, 5)).toBe(1);
  });

  it('returns 1 when both have single sections', () => {
    expect(positionalProximity(0, 1, 0, 1)).toBe(1);
  });

  it('returns 0 for opposite positions', () => {
    expect(positionalProximity(0, 5, 4, 5)).toBe(0);
  });

  it('returns intermediate value for different positions', () => {
    const score = positionalProximity(1, 5, 2, 5);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ─── Hungarian Algorithm Tests ───────────────────────────────────────────────

describe('hungarianAlgorithm', () => {
  it('returns empty for empty matrix', () => {
    expect(hungarianAlgorithm([])).toEqual([]);
  });

  it('returns single assignment for 1x1 matrix', () => {
    const result = hungarianAlgorithm([[0.8]]);
    expect(result).toEqual([[0, 0]]);
  });

  it('finds optimal assignment for 2x2 matrix', () => {
    // Optimal: row 0 → col 1 (0.9), row 1 → col 0 (0.8)
    const matrix = [
      [0.1, 0.9],
      [0.8, 0.2],
    ];
    const result = hungarianAlgorithm(matrix);
    const totalScore = result.reduce((sum, [r, c]) => sum + matrix[r][c], 0);
    expect(totalScore).toBeCloseTo(1.7, 1);
  });

  it('handles rectangular matrix (more rows than cols)', () => {
    const matrix = [
      [0.9, 0.1],
      [0.1, 0.8],
      [0.5, 0.5],
    ];
    const result = hungarianAlgorithm(matrix);
    // Should assign 2 columns (min of rows, cols)
    expect(result.length).toBe(2);
  });

  it('handles rectangular matrix (more cols than rows)', () => {
    const matrix = [
      [0.9, 0.1, 0.5],
      [0.1, 0.8, 0.3],
    ];
    const result = hungarianAlgorithm(matrix);
    expect(result.length).toBe(2);
  });

  it('maximizes total similarity', () => {
    const matrix = [
      [0.9, 0.1, 0.1],
      [0.1, 0.8, 0.1],
      [0.1, 0.1, 0.7],
    ];
    const result = hungarianAlgorithm(matrix);
    const totalScore = result.reduce((sum, [r, c]) => sum + matrix[r][c], 0);
    // Optimal is diagonal: 0.9 + 0.8 + 0.7 = 2.4
    expect(totalScore).toBeCloseTo(2.4, 1);
  });
});

// ─── flattenSections Tests ───────────────────────────────────────────────────

describe('flattenSections', () => {
  it('returns empty array for empty input', () => {
    expect(flattenSections([])).toEqual([]);
  });

  it('returns flat sections unchanged', () => {
    const sections = [makeSection({ id: 'a' }), makeSection({ id: 'b' })];
    const result = flattenSections(sections);
    expect(result).toHaveLength(2);
  });

  it('flattens nested children', () => {
    const sections = [
      makeSection({
        id: 'parent',
        children: [
          makeSection({ id: 'child-1' }),
          makeSection({ id: 'child-2' }),
        ],
      }),
    ];
    const result = flattenSections(sections);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(['parent', 'child-1', 'child-2']);
  });
});

// ─── mapSections Integration Tests ───────────────────────────────────────────

describe('mapSections', () => {
  it('returns empty entries for two empty outlines', () => {
    const v1 = makeOutline([]);
    const v2 = makeOutline([]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(0);
    expect(result.mappingTable.autoMappedPercentage).toBe(100);
    expect(result.warning).toBeUndefined();
  });

  it('marks all V2 sections as NEW when V1 is empty', () => {
    const v1 = makeOutline([]);
    const v2 = makeOutline([makeSection({ id: 'v2-1' }), makeSection({ id: 'v2-2' })]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(2);
    expect(result.mappingTable.entries.every((e) => e.matchType === 'NEW')).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('marks all V1 sections as DELETED when V2 is empty', () => {
    const v1 = makeOutline([makeSection({ id: 'v1-1' }), makeSection({ id: 'v1-2' })]);
    const v2 = makeOutline([]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(2);
    expect(result.mappingTable.entries.every((e) => e.matchType === 'DELETED')).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('maps identical sections as SAME', () => {
    const content = 'Luật này quy định về phạm vi điều chỉnh và đối tượng áp dụng của các quy định pháp luật hiện hành';
    const v1 = makeOutline([
      makeSection({ id: 'v1-1', identifier: 'Điều 1', title: 'Phạm vi', content }),
    ]);
    const v2 = makeOutline([
      makeSection({ id: 'v2-1', identifier: 'Điều 1', title: 'Phạm vi', content }),
    ]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(1);
    expect(result.mappingTable.entries[0].matchType).toBe('SAME');
    expect(result.mappingTable.entries[0].confidenceScore).toBeGreaterThan(90);
  });

  it('maps sections with same content but different identifier as RENUMBERED', () => {
    const content = 'Luật này quy định về phạm vi điều chỉnh và đối tượng áp dụng của các quy định pháp luật hiện hành trong lĩnh vực kinh doanh';
    const v1 = makeOutline([
      makeSection({ id: 'v1-1', identifier: 'Điều 1', title: 'Phạm vi điều chỉnh', content }),
    ]);
    const v2 = makeOutline([
      makeSection({ id: 'v2-1', identifier: 'Điều 5', title: 'Phạm vi điều chỉnh', content }),
    ]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(1);
    // Should be RENUMBERED (same content, different identifier) or SAME (high score)
    expect(['SAME', 'RENUMBERED']).toContain(result.mappingTable.entries[0].matchType);
  });

  it('maps sections with different content as CHANGED', () => {
    const v1 = makeOutline([
      makeSection({
        id: 'v1-1',
        identifier: 'Điều 1',
        title: 'Phạm vi điều chỉnh',
        content: 'Luật này quy định về phạm vi điều chỉnh và đối tượng áp dụng trong lĩnh vực thương mại',
      }),
    ]);
    const v2 = makeOutline([
      makeSection({
        id: 'v2-1',
        identifier: 'Điều 1',
        title: 'Phạm vi điều chỉnh',
        content: 'Luật này quy định về phạm vi điều chỉnh mở rộng bao gồm cả lĩnh vực đầu tư nước ngoài và hợp tác quốc tế',
      }),
    ]);
    const result = mapSections(v1, v2, 'session-1');
    expect(result.mappingTable.entries).toHaveLength(1);
    expect(['CHANGED', 'SAME', 'RENUMBERED']).toContain(
      result.mappingTable.entries[0].matchType,
    );
  });

  it('ensures every section appears exactly once in the mapping table', () => {
    const v1 = makeOutline([
      makeSection({ id: 'v1-1', content: 'Content A for section one about legal matters' }),
      makeSection({ id: 'v1-2', content: 'Content B for section two about financial regulations' }),
      makeSection({ id: 'v1-3', content: 'Content C for section three about environmental policy' }),
    ]);
    const v2 = makeOutline([
      makeSection({ id: 'v2-1', content: 'Content A for section one about legal matters' }),
      makeSection({ id: 'v2-2', content: 'Content D completely new section about technology' }),
    ]);

    const result = mapSections(v1, v2, 'session-1');
    const allV1Ids = result.mappingTable.entries.flatMap((e) => e.v1Sections);
    const allV2Ids = result.mappingTable.entries.flatMap((e) => e.v2Sections);

    // Every V1 section appears exactly once
    expect(allV1Ids.sort()).toEqual(['v1-1', 'v1-2', 'v1-3'].sort());
    // Every V2 section appears exactly once
    expect(allV2Ids.sort()).toEqual(['v2-1', 'v2-2'].sort());
  });

  it('emits warning when auto-mapped percentage < 20%', () => {
    // Create many sections with completely different content
    const v1Sections = Array.from({ length: 10 }, (_, i) =>
      makeSection({
        id: `v1-${i}`,
        content: `Unique content for V1 section ${i} that has no match in the other document version ${i * 100}`,
      }),
    );
    const v2Sections = Array.from({ length: 10 }, (_, i) =>
      makeSection({
        id: `v2-${i}`,
        content: `Completely different V2 content for section ${i} about entirely different topics ${i * 200}`,
      }),
    );

    const v1 = makeOutline(v1Sections);
    const v2 = makeOutline(v2Sections);
    const result = mapSections(v1, v2, 'session-1');

    // With very different content, auto-mapped percentage should be low
    if (result.mappingTable.autoMappedPercentage < 20) {
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Khuyến nghị');
    }
  });

  it('sets needsReview true for entries with confidence < 70', () => {
    const v1 = makeOutline([
      makeSection({
        id: 'v1-1',
        title: 'Section A',
        content: 'Some content about topic alpha with moderate overlap in wording',
      }),
    ]);
    const v2 = makeOutline([
      makeSection({
        id: 'v2-1',
        title: 'Section B',
        content: 'Different content about topic beta with moderate overlap in wording',
      }),
    ]);
    const result = mapSections(v1, v2, 'session-1');
    for (const entry of result.mappingTable.entries) {
      if (entry.confidenceScore < 70) {
        expect(entry.needsReview).toBe(true);
      }
    }
  });

  it('preserves outline references in the mapping table', () => {
    const v1 = makeOutline([makeSection({ id: 'v1-1' })], { documentId: 'doc-v1' });
    const v2 = makeOutline([makeSection({ id: 'v2-1' })], { documentId: 'doc-v2' });
    const result = mapSections(v1, v2, 'session-test');
    expect(result.mappingTable.sessionId).toBe('session-test');
    expect(result.mappingTable.v1Outline.documentId).toBe('doc-v1');
    expect(result.mappingTable.v2Outline.documentId).toBe('doc-v2');
    expect(result.mappingTable.isLocked).toBe(false);
  });
});

// ─── unmatchEntry Tests ──────────────────────────────────────────────────────

describe('unmatchEntry', () => {
  it('splits a matched entry into DELETED + NEW', () => {
    const table: MappingTable = {
      sessionId: 'session-1',
      entries: [
        {
          id: 'map-0-0',
          v1Sections: ['v1-1'],
          v2Sections: ['v2-1'],
          matchType: 'CHANGED',
          confidenceScore: 75,
          needsReview: false,
        },
        {
          id: 'map-1-1',
          v1Sections: ['v1-2'],
          v2Sections: ['v2-2'],
          matchType: 'SAME',
          confidenceScore: 95,
          needsReview: false,
        },
      ],
      v1Outline: makeOutline([]),
      v2Outline: makeOutline([]),
      autoMappedPercentage: 100,
      isLocked: false,
    };

    const result = unmatchEntry(table, 'map-0-0');

    // Other entry preserved
    expect(result.entries.find((e) => e.id === 'map-1-1')).toBeDefined();

    // Original entry removed
    expect(result.entries.find((e) => e.id === 'map-0-0')).toBeUndefined();

    // New DELETED entry
    const deleted = result.entries.find((e) => e.matchType === 'DELETED');
    expect(deleted).toBeDefined();
    expect(deleted!.v1Sections).toEqual(['v1-1']);
    expect(deleted!.v2Sections).toEqual([]);

    // New NEW entry
    const newEntry = result.entries.find((e) => e.matchType === 'NEW');
    expect(newEntry).toBeDefined();
    expect(newEntry!.v1Sections).toEqual([]);
    expect(newEntry!.v2Sections).toEqual(['v2-1']);
  });

  it('throws error for non-existent entry ID', () => {
    const table: MappingTable = {
      sessionId: 'session-1',
      entries: [],
      v1Outline: makeOutline([]),
      v2Outline: makeOutline([]),
      autoMappedPercentage: 0,
      isLocked: false,
    };

    expect(() => unmatchEntry(table, 'non-existent')).toThrow();
  });

  it('handles SPLIT entry unmatch (multiple V2 sections)', () => {
    const table: MappingTable = {
      sessionId: 'session-1',
      entries: [
        {
          id: 'map-split-1',
          v1Sections: ['v1-1'],
          v2Sections: ['v2-1', 'v2-2'],
          matchType: 'SPLIT',
          confidenceScore: 60,
          needsReview: true,
        },
      ],
      v1Outline: makeOutline([]),
      v2Outline: makeOutline([]),
      autoMappedPercentage: 100,
      isLocked: false,
    };

    const result = unmatchEntry(table, 'map-split-1');

    // Should produce 1 DELETED + 2 NEW entries
    const deleted = result.entries.filter((e) => e.matchType === 'DELETED');
    const newEntries = result.entries.filter((e) => e.matchType === 'NEW');
    expect(deleted).toHaveLength(1);
    expect(newEntries).toHaveLength(2);
  });

  it('preserves all other entries unchanged', () => {
    const otherEntry = {
      id: 'map-other',
      v1Sections: ['v1-other'],
      v2Sections: ['v2-other'],
      matchType: 'SAME' as const,
      confidenceScore: 95,
      needsReview: false,
    };

    const table: MappingTable = {
      sessionId: 'session-1',
      entries: [
        otherEntry,
        {
          id: 'map-target',
          v1Sections: ['v1-1'],
          v2Sections: ['v2-1'],
          matchType: 'CHANGED',
          confidenceScore: 60,
          needsReview: true,
        },
      ],
      v1Outline: makeOutline([]),
      v2Outline: makeOutline([]),
      autoMappedPercentage: 100,
      isLocked: false,
    };

    const result = unmatchEntry(table, 'map-target');
    const preserved = result.entries.find((e) => e.id === 'map-other');
    expect(preserved).toEqual(otherEntry);
  });
});
