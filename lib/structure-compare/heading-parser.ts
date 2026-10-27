/**
 * Heading Parser for Structure-Mapped Document Comparison.
 *
 * Provides regex-based parsing for:
 * 1. Vietnamese legal document heading patterns (Phần, Chương, Mục, Điều, Khoản, Điểm)
 * 2. Standard heading markers (Markdown H1-H3, numbered sections like 1.2.3)
 *
 * Returns parsed headings with correct hierarchy levels and character positions.
 */

/**
 * Represents a single parsed heading found in the document text.
 */
export interface ParsedHeading {
  /** Display identifier, e.g. "Điều 1", "1.2.3", "# Title" */
  identifier: string;
  /** Heading title text (content after the identifier on the same line) */
  title: string;
  /** Hierarchy level based on heading type */
  level: number;
  /** Character position start in the source text */
  startPos: number;
  /** Character position end in the source text (end of the heading line) */
  endPos: number;
}

/**
 * Vietnamese legal heading hierarchy levels (only down to Điều/Article level):
 * - Phần (Part) → level 1
 * - Chương (Chapter) → level 2
 * - Mục (Section within chapter) → level 3
 * - Điều (Article) → level 4 (LEAF — deepest level for structure extraction)
 *
 * NOTE: Khoản (Clause) and Điểm (Point) are NOT extracted as separate headings.
 * They are included as part of the Điều's content for comparison purposes.
 */
const VIETNAMESE_LEGAL_PATTERNS: Array<{
  regex: RegExp;
  level: number;
  identifierGroup: number;
}> = [
  {
    // Phần I, Phần 1, PHẦN I, etc.
    regex: /^(Phần|PHẦN)\s+([IVXLCDM]+|\d+)\.?\s*(.*)/im,
    level: 1,
    identifierGroup: 0,
  },
  {
    // Chương I, Chương 1, CHƯƠNG I, etc.
    regex: /^(Chương|CHƯƠNG|Chuong|CHUONG)\s+([IVXLCDM]+|\d+)\.?\s*(.*)/im,
    level: 2,
    identifierGroup: 0,
  },
  {
    // Mục 1, MỤC 1, etc.
    regex: /^(Mục|MỤC)\s+(\d+)\.?\s*(.*)/im,
    level: 3,
    identifierGroup: 0,
  },
  {
    // Điều 1, ĐIỀU 1, Điều 1., etc. — LEAF level (deepest)
    regex: /^(Điều|ĐIỀU|Dieu|DIEU)\s+(\d+)\.?\s*(.*)/im,
    level: 4,
    identifierGroup: 0,
  },
  // NOTE: Khoản and Điểm are intentionally NOT included here.
  // They are part of the Điều's content, not separate structural sections.
];

/**
 * Standard heading patterns:
 * - Markdown H1 (#) → level 1
 * - Markdown H2 (##) → level 2
 * - Markdown H3 (###) → level 3
 * - Numbered sections: depth determines level (1. → level 1, 1.1 → level 2, 1.1.1 → level 3, etc.)
 */
const STANDARD_HEADING_PATTERNS: Array<{
  regex: RegExp;
  level: number | 'dynamic';
  identifierGroup: number;
}> = [
  {
    // Markdown H3: ### Title
    regex: /^###\s+(.*)/m,
    level: 3,
    identifierGroup: 0,
  },
  {
    // Markdown H2: ## Title
    regex: /^##\s+(.*)/m,
    level: 2,
    identifierGroup: 0,
  },
  {
    // Markdown H1: # Title
    regex: /^#\s+(.*)/m,
    level: 1,
    identifierGroup: 0,
  },
  {
    // Numbered sections: 1., 1.1, 1.1.1, etc.
    // Must be at start of line, followed by space or end
    regex: /^(\d+(?:\.\d+)*)\.?\s+(.*)/m,
    level: 'dynamic',
    identifierGroup: 0,
  },
];

/**
 * Calculate the hierarchy level for a numbered section based on its depth.
 * "1" → level 1, "1.1" → level 2, "1.1.1" → level 3, etc.
 */
function getNumberedSectionLevel(numbering: string): number {
  const parts = numbering.split('.');
  return parts.length;
}

/**
 * Parse all headings from a document text string.
 *
 * Identifies both Vietnamese legal heading patterns and standard heading markers.
 * Returns headings sorted by their position in the document.
 *
 * @param text - The full document text to parse
 * @returns Array of ParsedHeading objects sorted by startPos
 */
export function parseHeadings(text: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];

  // Process line by line to get accurate positions
  const lines = text.split('\n');
  let currentPos = 0;

  for (const line of lines) {
    const trimmedLine = line.trimStart();
    const leadingWhitespace = line.length - trimmedLine.length;
    let matched = false;

    // Try Vietnamese legal patterns first (higher priority)
    for (const pattern of VIETNAMESE_LEGAL_PATTERNS) {
      const match = trimmedLine.match(pattern.regex);
      if (match) {
        // Build identifier from the keyword + number/letter part
        const keyword = match[1];
        const numberPart = match[2];
        const identifier = `${keyword} ${numberPart}`;
        const title = match[3]?.trim() || '';

        headings.push({
          identifier,
          title,
          level: pattern.level,
          startPos: currentPos + leadingWhitespace,
          endPos: currentPos + line.length,
        });
        matched = true;
        break;
      }
    }

    // Try standard heading patterns if no Vietnamese pattern matched
    if (!matched) {
      // Check markdown headings (order matters: ### before ## before #)
      const h3Match = trimmedLine.match(/^###\s+(.*)/);
      if (h3Match) {
        headings.push({
          identifier: '###',
          title: h3Match[1].trim(),
          level: 3,
          startPos: currentPos + leadingWhitespace,
          endPos: currentPos + line.length,
        });
        matched = true;
      }

      if (!matched) {
        const h2Match = trimmedLine.match(/^##\s+(.*)/);
        if (h2Match) {
          headings.push({
            identifier: '##',
            title: h2Match[1].trim(),
            level: 2,
            startPos: currentPos + leadingWhitespace,
            endPos: currentPos + line.length,
          });
          matched = true;
        }
      }

      if (!matched) {
        const h1Match = trimmedLine.match(/^#\s+(.*)/);
        if (h1Match) {
          headings.push({
            identifier: '#',
            title: h1Match[1].trim(),
            level: 1,
            startPos: currentPos + leadingWhitespace,
            endPos: currentPos + line.length,
          });
          matched = true;
        }
      }

      // Numbered sections (only if no markdown heading matched)
      if (!matched) {
        const numberedMatch = trimmedLine.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)/);
        if (numberedMatch) {
          const numbering = numberedMatch[1];
          const title = numberedMatch[2].trim();

          // Only treat as heading if the numbering is reasonable (not just a random number in text)
          // A numbered section should have a title after it
          if (title.length > 0) {
            headings.push({
              identifier: numbering,
              title,
              level: getNumberedSectionLevel(numbering),
              startPos: currentPos + leadingWhitespace,
              endPos: currentPos + line.length,
            });
          }
        }
      }
    }

    // Move position past this line + the newline character
    currentPos += line.length + 1; // +1 for the \n
  }

  return headings;
}
