/**
 * Section Mapper for Structure-Mapped Document Comparison.
 *
 * Implements multi-signal scoring and optimal assignment to map sections
 * between two document versions (V1 → V2).
 *
 * Algorithm:
 * 1. Compute pairwise similarity matrix (title 0.3 + content 0.5 + position 0.2)
 * 2. Apply Hungarian algorithm for optimal assignment (maximize total similarity)
 * 3. Post-process: classify matches as SAME/RENUMBERED/CHANGED
 * 4. Detect SPLIT/MERGED patterns among unmatched sections
 * 5. Mark remaining unmatched as DELETED/NEW
 * 6. Emit low-overlap warning when auto-mapped percentage < 20%
 */

import type {
  DocumentOutline,
  OutlineSection,
  MappingTable,
  MappingEntry,
  MatchType,
} from './types';

// ─── Exported Result Type ────────────────────────────────────────────────────

/**
 * Result of the section mapping operation.
 * Includes the MappingTable and an optional warning for low-overlap cases.
 */
export interface MapperResult {
  mappingTable: MappingTable;
  /** Warning message when auto-mapped percentage < 20% */
  warning?: string;
}

// ─── Scoring Weights ─────────────────────────────────────────────────────────

const WEIGHT_TITLE = 0.3;
const WEIGHT_CONTENT = 0.5;
const WEIGHT_POSITION = 0.2;

// ─── Thresholds ──────────────────────────────────────────────────────────────

const THRESHOLD_SAME = 0.9;
const THRESHOLD_RENUMBERED = 0.7;
const THRESHOLD_CHANGED = 0.5;
const THRESHOLD_UNMATCHED = 0.3;
const LOW_OVERLAP_PERCENTAGE = 20;

// ─── Similarity Functions ────────────────────────────────────────────────────

/**
 * Normalized Levenshtein distance between two strings.
 * Returns a similarity score in [0, 1] where 1 = identical.
 */
export function titleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  const lenA = la.length;
  const lenB = lb.length;

  // Create DP matrix for Levenshtein distance
  const dp: number[][] = Array.from({ length: lenA + 1 }, () =>
    Array(lenB + 1).fill(0),
  );

  for (let i = 0; i <= lenA; i++) dp[i][0] = i;
  for (let j = 0; j <= lenB; j++) dp[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = la[i - 1] === lb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  const maxLen = Math.max(lenA, lenB);
  return 1 - dp[lenA][lenB] / maxLen;
}

/**
 * Extract word n-grams from text.
 */
function extractNgrams(text: string, n: number): Set<string> {
  const words = text
    .toLowerCase()
    // Remove punctuation/special chars, keep letters, digits, whitespace
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u0100-\u017F\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Jaccard similarity of word n-grams (n=3) between two text strings.
 * Returns a score in [0, 1] where 1 = identical n-gram sets.
 */
export function contentSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const ngramsA = extractNgrams(a, 3);
  const ngramsB = extractNgrams(b, 3);

  // If either text is too short for trigrams, fall back to unigrams
  if (ngramsA.size === 0 || ngramsB.size === 0) {
    const uniA = extractNgrams(a, 1);
    const uniB = extractNgrams(b, 1);
    if (uniA.size === 0 || uniB.size === 0) return 0;
    let intersection = 0;
    Array.from(uniA).forEach((gram) => {
      if (uniB.has(gram)) intersection++;
    });
    const union = uniA.size + uniB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  let intersection = 0;
  Array.from(ngramsA).forEach((gram) => {
    if (ngramsB.has(gram)) intersection++;
  });
  const union = ngramsA.size + ngramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Positional proximity score based on normalized position difference.
 * Returns a score in [0, 1] where 1 = same relative position.
 */
export function positionalProximity(
  indexA: number,
  totalA: number,
  indexB: number,
  totalB: number,
): number {
  if (totalA <= 1 && totalB <= 1) return 1;
  const posA = totalA <= 1 ? 0 : indexA / (totalA - 1);
  const posB = totalB <= 1 ? 0 : indexB / (totalB - 1);
  return 1 - Math.abs(posA - posB);
}

/**
 * Compute the combined similarity score between two sections.
 */
export function computeSimilarity(
  sectionA: OutlineSection,
  indexA: number,
  totalA: number,
  sectionB: OutlineSection,
  indexB: number,
  totalB: number,
): number {
  const title = titleSimilarity(sectionA.title, sectionB.title);
  const content = contentSimilarity(sectionA.content, sectionB.content);
  const position = positionalProximity(indexA, totalA, indexB, totalB);

  return WEIGHT_TITLE * title + WEIGHT_CONTENT * content + WEIGHT_POSITION * position;
}

// ─── Hungarian Algorithm ─────────────────────────────────────────────────────

/**
 * Hungarian algorithm for optimal assignment (maximizing total similarity).
 *
 * Converts the maximization problem to minimization by using (maxVal - score)
 * as the cost matrix, then solves the standard assignment problem.
 *
 * Handles rectangular matrices (different number of V1 and V2 sections)
 * by padding to a square matrix.
 *
 * @param costMatrix - n×m matrix of similarity scores (higher = better match)
 * @returns Array of [row, col] assignments for the original (non-padded) dimensions
 */
export function hungarianAlgorithm(
  costMatrix: number[][],
): Array<[number, number]> {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0]?.length ?? 0;
  if (m === 0) return [];

  const size = Math.max(n, m);

  // Find max value for conversion to minimization problem
  let maxVal = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (costMatrix[i][j] > maxVal) maxVal = costMatrix[i][j];
    }
  }

  // Build square cost matrix (minimization: maxVal - score)
  // Padded cells get cost 0 (maxVal - maxVal) so they don't affect assignment
  const cost: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      if (i < n && j < m) return maxVal - costMatrix[i][j];
      return maxVal; // high cost for dummy assignments
    }),
  );

  // Standard Hungarian algorithm (Kuhn-Munkres)
  const u = new Array(size + 1).fill(0);
  const v = new Array(size + 1).fill(0);
  const p = new Array(size + 1).fill(0); // p[j] = row assigned to column j
  const way = new Array(size + 1).fill(0);

  for (let i = 1; i <= size; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(size + 1).fill(Infinity);
    const used = new Array(size + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;

      for (let j = 1; j <= size; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    // Trace back the augmenting path
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Extract assignments (only for original dimensions)
  const result: Array<[number, number]> = [];
  for (let j = 1; j <= size; j++) {
    if (p[j] > 0 && p[j] <= n && j <= m) {
      result.push([p[j] - 1, j - 1]);
    }
  }

  return result;
}

// ─── SPLIT/MERGED Detection ──────────────────────────────────────────────────

/**
 * Check if an unmatched V1 section's content appears distributed across
 * multiple V2 sections (SPLIT detection).
 *
 * Returns the V2 section IDs if a split is detected, or null otherwise.
 */
function detectSplit(
  v1Section: OutlineSection,
  unmatchedV2Sections: OutlineSection[],
  allV2Sections: OutlineSection[],
): string[] | null {
  if (unmatchedV2Sections.length < 2) return null;

  // Check if the V1 section's content n-grams are distributed across multiple V2 sections
  const v1Ngrams = extractNgrams(v1Section.content, 3);
  if (v1Ngrams.size === 0) return null;

  const coverageBySection: Array<{ id: string; coverage: number }> = [];

  for (const v2Section of unmatchedV2Sections) {
    const v2Ngrams = extractNgrams(v2Section.content, 3);
    let overlap = 0;
    Array.from(v2Ngrams).forEach((gram) => {
      if (v1Ngrams.has(gram)) overlap++;
    });
    const coverage = v1Ngrams.size > 0 ? overlap / v1Ngrams.size : 0;
    if (coverage > 0.1) {
      coverageBySection.push({ id: v2Section.id, coverage });
    }
  }

  // A split is detected if 2+ V2 sections together cover > 50% of V1 content
  if (coverageBySection.length >= 2) {
    const totalCoverage = coverageBySection.reduce((sum, s) => sum + s.coverage, 0);
    if (totalCoverage > 0.5) {
      return coverageBySection.map((s) => s.id);
    }
  }

  return null;
}

/**
 * Check if multiple unmatched V1 sections' content appears merged into
 * a single V2 section (MERGED detection).
 *
 * Returns the V1 section IDs if a merge is detected, or null otherwise.
 */
function detectMerged(
  v2Section: OutlineSection,
  unmatchedV1Sections: OutlineSection[],
): string[] | null {
  if (unmatchedV1Sections.length < 2) return null;

  const v2Ngrams = extractNgrams(v2Section.content, 3);
  if (v2Ngrams.size === 0) return null;

  const coverageBySection: Array<{ id: string; coverage: number }> = [];

  for (const v1Section of unmatchedV1Sections) {
    const v1Ngrams = extractNgrams(v1Section.content, 3);
    let overlap = 0;
    Array.from(v1Ngrams).forEach((gram) => {
      if (v2Ngrams.has(gram)) overlap++;
    });
    const coverage = v1Ngrams.size > 0 ? overlap / v1Ngrams.size : 0;
    if (coverage > 0.3) {
      coverageBySection.push({ id: v1Section.id, coverage });
    }
  }

  // A merge is detected if 2+ V1 sections each have > 30% of their content in the V2 section
  if (coverageBySection.length >= 2) {
    return coverageBySection.map((s) => s.id);
  }

  return null;
}

// ─── Flatten Sections Helper ─────────────────────────────────────────────────

/**
 * Flatten a hierarchical section tree into a flat array.
 * Recursively includes children.
 */
export function flattenSections(sections: OutlineSection[]): OutlineSection[] {
  const result: OutlineSection[] = [];
  for (const section of sections) {
    result.push(section);
    if (section.children && section.children.length > 0) {
      result.push(...flattenSections(section.children));
    }
  }
  return result;
}

// ─── Main Mapper Function ────────────────────────────────────────────────────

/**
 * Map sections between two document outlines using multi-signal scoring
 * and the Hungarian algorithm for optimal assignment.
 *
 * @param v1Outline - Document outline for version 1
 * @param v2Outline - Document outline for version 2
 * @param sessionId - Session identifier for the mapping table
 * @returns MapperResult containing the MappingTable and optional warning
 */
export function mapSections(
  v1Outline: DocumentOutline,
  v2Outline: DocumentOutline,
  sessionId: string,
): MapperResult {
  const v1Sections = flattenSections(v1Outline.sections);
  const v2Sections = flattenSections(v2Outline.sections);

  const totalV1 = v1Sections.length;
  const totalV2 = v2Sections.length;

  // Handle edge case: empty outlines
  if (totalV1 === 0 && totalV2 === 0) {
    return {
      mappingTable: {
        sessionId,
        entries: [],
        v1Outline,
        v2Outline,
        autoMappedPercentage: 100,
        isLocked: false,
      },
    };
  }

  if (totalV1 === 0) {
    // All V2 sections are NEW
    const entries: MappingEntry[] = v2Sections.map((s, idx) => ({
      id: `map-new-${idx}`,
      v1Sections: [],
      v2Sections: [s.id],
      matchType: 'NEW' as MatchType,
      confidenceScore: 100,
      needsReview: false,
    }));
    return {
      mappingTable: {
        sessionId,
        entries,
        v1Outline,
        v2Outline,
        autoMappedPercentage: 0,
        isLocked: false,
      },
      warning: 'Hai tài liệu có cấu trúc rất khác nhau (0% ghép cặp tự động). Khuyến nghị dùng So sánh Ngữ nghĩa thông thường.',
    };
  }

  if (totalV2 === 0) {
    // All V1 sections are DELETED
    const entries: MappingEntry[] = v1Sections.map((s, idx) => ({
      id: `map-del-${idx}`,
      v1Sections: [s.id],
      v2Sections: [],
      matchType: 'DELETED' as MatchType,
      confidenceScore: 100,
      needsReview: false,
    }));
    return {
      mappingTable: {
        sessionId,
        entries,
        v1Outline,
        v2Outline,
        autoMappedPercentage: 0,
        isLocked: false,
      },
      warning: 'Hai tài liệu có cấu trúc rất khác nhau (0% ghép cặp tự động). Khuyến nghị dùng So sánh Ngữ nghĩa thông thường.',
    };
  }

  // Step 1: Compute pairwise similarity matrix
  const similarityMatrix: number[][] = Array.from({ length: totalV1 }, (_, i) =>
    Array.from({ length: totalV2 }, (_, j) =>
      computeSimilarity(
        v1Sections[i],
        i,
        totalV1,
        v2Sections[j],
        j,
        totalV2,
      ),
    ),
  );

  // Step 2: Apply Hungarian algorithm for optimal assignment
  const assignments = hungarianAlgorithm(similarityMatrix);

  // Step 3: Post-process assignments - classify matches
  const entries: MappingEntry[] = [];
  const matchedV1Indices = new Set<number>();
  const matchedV2Indices = new Set<number>();
  let autoMappedCount = 0;

  for (const [v1Idx, v2Idx] of assignments) {
    const score = similarityMatrix[v1Idx][v2Idx];

    if (score < THRESHOLD_UNMATCHED) {
      // Score too low - leave as unmatched for SPLIT/MERGED/DELETED/NEW detection
      continue;
    }

    matchedV1Indices.add(v1Idx);
    matchedV2Indices.add(v2Idx);
    autoMappedCount++;

    const v1Section = v1Sections[v1Idx];
    const v2Section = v2Sections[v2Idx];
    const confidenceScore = Math.round(score * 100);

    let matchType: MatchType;
    if (score > THRESHOLD_SAME) {
      matchType = 'SAME';
    } else if (score > THRESHOLD_RENUMBERED && v1Section.identifier !== v2Section.identifier) {
      matchType = 'RENUMBERED';
    } else if (score > THRESHOLD_CHANGED) {
      matchType = 'CHANGED';
    } else {
      // Between THRESHOLD_UNMATCHED and THRESHOLD_CHANGED
      matchType = 'CHANGED';
    }

    entries.push({
      id: `map-${v1Idx}-${v2Idx}`,
      v1Sections: [v1Section.id],
      v2Sections: [v2Section.id],
      matchType,
      confidenceScore,
      needsReview: confidenceScore < 70,
    });
  }

  // Step 4: Detect SPLIT/MERGED patterns among unmatched sections
  const unmatchedV1Indices = Array.from(
    { length: totalV1 },
    (_, i) => i,
  ).filter((i) => !matchedV1Indices.has(i));

  const unmatchedV2Indices = Array.from(
    { length: totalV2 },
    (_, j) => j,
  ).filter((j) => !matchedV2Indices.has(j));

  const unmatchedV1Sections = unmatchedV1Indices.map((i) => v1Sections[i]);
  const unmatchedV2Sections = unmatchedV2Indices.map((j) => v2Sections[j]);

  // Track which unmatched sections get consumed by SPLIT/MERGED
  const consumedV1Ids = new Set<string>();
  const consumedV2Ids = new Set<string>();

  // Detect SPLITs: one V1 section → multiple V2 sections
  for (const v1Section of unmatchedV1Sections) {
    if (consumedV1Ids.has(v1Section.id)) continue;

    const availableV2 = unmatchedV2Sections.filter(
      (s) => !consumedV2Ids.has(s.id),
    );
    const splitTargets = detectSplit(v1Section, availableV2, v2Sections);

    if (splitTargets && splitTargets.length >= 2) {
      consumedV1Ids.add(v1Section.id);
      for (const id of splitTargets) {
        consumedV2Ids.add(id);
      }

      entries.push({
        id: `map-split-${v1Section.id}`,
        v1Sections: [v1Section.id],
        v2Sections: splitTargets,
        matchType: 'SPLIT',
        confidenceScore: 60,
        needsReview: true,
      });
      autoMappedCount++;
    }
  }

  // Detect MERGEDs: multiple V1 sections → one V2 section
  for (const v2Section of unmatchedV2Sections) {
    if (consumedV2Ids.has(v2Section.id)) continue;

    const availableV1 = unmatchedV1Sections.filter(
      (s) => !consumedV1Ids.has(s.id),
    );
    const mergedSources = detectMerged(v2Section, availableV1);

    if (mergedSources && mergedSources.length >= 2) {
      consumedV2Ids.add(v2Section.id);
      for (const id of mergedSources) {
        consumedV1Ids.add(id);
      }

      entries.push({
        id: `map-merged-${v2Section.id}`,
        v1Sections: mergedSources,
        v2Sections: [v2Section.id],
        matchType: 'MERGED',
        confidenceScore: 60,
        needsReview: true,
      });
      autoMappedCount++;
    }
  }

  // Step 5: Mark remaining unmatched sections as DELETED/NEW
  for (const v1Section of unmatchedV1Sections) {
    if (consumedV1Ids.has(v1Section.id)) continue;
    entries.push({
      id: `map-del-${v1Section.id}`,
      v1Sections: [v1Section.id],
      v2Sections: [],
      matchType: 'DELETED',
      confidenceScore: 100,
      needsReview: false,
    });
  }

  for (const v2Section of unmatchedV2Sections) {
    if (consumedV2Ids.has(v2Section.id)) continue;
    entries.push({
      id: `map-new-${v2Section.id}`,
      v1Sections: [],
      v2Sections: [v2Section.id],
      matchType: 'NEW',
      confidenceScore: 100,
      needsReview: false,
    });
  }

  // Step 6: Calculate auto-mapped percentage and emit warning if needed
  const totalSections = Math.max(totalV1, totalV2);
  const autoMappedPercentage =
    totalSections > 0 ? Math.round((autoMappedCount / totalSections) * 100) : 0;

  let warning: string | undefined;
  if (autoMappedPercentage < LOW_OVERLAP_PERCENTAGE) {
    warning = `Hai tài liệu có cấu trúc rất khác nhau (${autoMappedPercentage}% ghép cặp tự động). Khuyến nghị dùng So sánh Ngữ nghĩa thông thường.`;
  }

  const mappingTable: MappingTable = {
    sessionId,
    entries,
    v1Outline,
    v2Outline,
    autoMappedPercentage,
    isLocked: false,
  };

  return { mappingTable, warning };
}

// ─── Unmatch Operation ───────────────────────────────────────────────────────

/**
 * Unmatch a mapping entry: splits a matched pair into one DELETED (V1) and one NEW (V2) entry.
 * Preserves all other entries unchanged.
 *
 * @param table - The current MappingTable
 * @param entryId - The ID of the entry to unmatch
 * @returns A new MappingTable with the entry split into DELETED + NEW
 */
export function unmatchEntry(table: MappingTable, entryId: string): MappingTable {
  const entry = table.entries.find((e) => e.id === entryId);
  if (!entry) {
    throw new Error(`Entry with id "${entryId}" not found in mapping table`);
  }

  const otherEntries = table.entries.filter((e) => e.id !== entryId);

  const newEntries: MappingEntry[] = [];

  // Create DELETED entries for each V1 section
  for (const v1Id of entry.v1Sections) {
    newEntries.push({
      id: `map-del-${v1Id}`,
      v1Sections: [v1Id],
      v2Sections: [],
      matchType: 'DELETED',
      confidenceScore: 100,
      needsReview: false,
    });
  }

  // Create NEW entries for each V2 section
  for (const v2Id of entry.v2Sections) {
    newEntries.push({
      id: `map-new-${v2Id}`,
      v1Sections: [],
      v2Sections: [v2Id],
      matchType: 'NEW',
      confidenceScore: 100,
      needsReview: false,
    });
  }

  return {
    ...table,
    entries: [...otherEntries, ...newEntries],
    isLocked: false,
  };
}
