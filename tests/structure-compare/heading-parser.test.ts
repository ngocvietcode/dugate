/**
 * Unit tests for the heading parser module.
 *
 * Tests Vietnamese legal heading patterns and standard heading detection.
 */
import { parseHeadings, ParsedHeading } from '@/lib/structure-compare/heading-parser';

describe('heading-parser', () => {
  describe('Vietnamese legal heading patterns', () => {
    it('parses Phần (Part) at level 1', () => {
      const text = 'Phần I Quy định chung';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Phần I');
      expect(result[0].title).toBe('Quy định chung');
      expect(result[0].level).toBe(1);
    });

    it('parses PHẦN (uppercase) at level 1', () => {
      const text = 'PHẦN 2 Quy định cụ thể';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('PHẦN 2');
      expect(result[0].level).toBe(1);
    });

    it('parses Chương (Chapter) at level 2', () => {
      const text = 'Chương III Điều kiện kinh doanh';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Chương III');
      expect(result[0].title).toBe('Điều kiện kinh doanh');
      expect(result[0].level).toBe(2);
    });

    it('parses Mục (Section) at level 3', () => {
      const text = 'Mục 2 Trách nhiệm của cơ quan';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Mục 2');
      expect(result[0].title).toBe('Trách nhiệm của cơ quan');
      expect(result[0].level).toBe(3);
    });

    it('parses Điều (Article) at level 4', () => {
      const text = 'Điều 15 Quyền và nghĩa vụ';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Điều 15');
      expect(result[0].title).toBe('Quyền và nghĩa vụ');
      expect(result[0].level).toBe(4);
    });

    it('parses ĐIỀU (uppercase) at level 4', () => {
      const text = 'ĐIỀU 3. Giải thích từ ngữ';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('ĐIỀU 3');
      expect(result[0].title).toBe('Giải thích từ ngữ');
      expect(result[0].level).toBe(4);
    });

    it('parses Khoản (Clause) at level 5', () => {
      const text = 'Khoản 3 Nội dung khoản';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Khoản 3');
      expect(result[0].title).toBe('Nội dung khoản');
      expect(result[0].level).toBe(5);
    });

    it('parses Điểm (Point) at level 6', () => {
      const text = 'Điểm a Nội dung điểm';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Điểm a');
      expect(result[0].title).toBe('Nội dung điểm');
      expect(result[0].level).toBe(6);
    });

    it('parses Điểm with closing parenthesis', () => {
      const text = 'Điểm b) Nội dung điểm b';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('Điểm b');
      expect(result[0].title).toBe('Nội dung điểm b');
      expect(result[0].level).toBe(6);
    });

    it('parses a full Vietnamese legal document structure', () => {
      const text = [
        'Phần I Quy định chung',
        'Chương I Phạm vi điều chỉnh',
        'Điều 1 Phạm vi',
        'Khoản 1 Nội dung khoản 1',
        'Điểm a Nội dung điểm a',
        'Điểm b Nội dung điểm b',
        'Khoản 2 Nội dung khoản 2',
        'Điều 2 Đối tượng áp dụng',
        'Chương II Quyền và nghĩa vụ',
        'Mục 1 Quyền',
        'Điều 3 Quyền cơ bản',
      ].join('\n');

      const result = parseHeadings(text);
      expect(result).toHaveLength(11);

      // Verify hierarchy levels
      expect(result[0].level).toBe(1); // Phần
      expect(result[1].level).toBe(2); // Chương
      expect(result[2].level).toBe(4); // Điều
      expect(result[3].level).toBe(5); // Khoản
      expect(result[4].level).toBe(6); // Điểm
      expect(result[5].level).toBe(6); // Điểm
      expect(result[6].level).toBe(5); // Khoản
      expect(result[7].level).toBe(4); // Điều
      expect(result[8].level).toBe(2); // Chương
      expect(result[9].level).toBe(3); // Mục
      expect(result[10].level).toBe(4); // Điều
    });
  });

  describe('Standard heading patterns', () => {
    it('parses Markdown H1 at level 1', () => {
      const text = '# Introduction';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('#');
      expect(result[0].title).toBe('Introduction');
      expect(result[0].level).toBe(1);
    });

    it('parses Markdown H2 at level 2', () => {
      const text = '## Section Title';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('##');
      expect(result[0].title).toBe('Section Title');
      expect(result[0].level).toBe(2);
    });

    it('parses Markdown H3 at level 3', () => {
      const text = '### Subsection';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('###');
      expect(result[0].title).toBe('Subsection');
      expect(result[0].level).toBe(3);
    });

    it('parses numbered section 1. at level 1', () => {
      const text = '1. First section';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('1');
      expect(result[0].title).toBe('First section');
      expect(result[0].level).toBe(1);
    });

    it('parses numbered section 1.2 at level 2', () => {
      const text = '1.2 Subsection title';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('1.2');
      expect(result[0].title).toBe('Subsection title');
      expect(result[0].level).toBe(2);
    });

    it('parses numbered section 1.2.3 at level 3', () => {
      const text = '1.2.3 Deep subsection';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('1.2.3');
      expect(result[0].title).toBe('Deep subsection');
      expect(result[0].level).toBe(3);
    });

    it('parses numbered section with trailing dot', () => {
      const text = '2.1. Another section';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('2.1');
      expect(result[0].title).toBe('Another section');
      expect(result[0].level).toBe(2);
    });

    it('parses mixed markdown headings', () => {
      const text = [
        '# Main Title',
        'Some content here',
        '## Chapter One',
        'More content',
        '### Details',
      ].join('\n');

      const result = parseHeadings(text);
      expect(result).toHaveLength(3);
      expect(result[0].level).toBe(1);
      expect(result[1].level).toBe(2);
      expect(result[2].level).toBe(3);
    });
  });

  describe('Character positions', () => {
    it('returns correct startPos and endPos for single heading', () => {
      const text = 'Điều 1 Phạm vi';
      const result = parseHeadings(text);
      expect(result[0].startPos).toBe(0);
      expect(result[0].endPos).toBe(text.length);
    });

    it('returns correct positions for multiple headings', () => {
      const text = 'Điều 1 Phạm vi\nĐiều 2 Đối tượng';
      const result = parseHeadings(text);
      expect(result[0].startPos).toBe(0);
      expect(result[0].endPos).toBe('Điều 1 Phạm vi'.length);
      expect(result[1].startPos).toBe('Điều 1 Phạm vi'.length + 1); // +1 for \n
      expect(result[1].endPos).toBe(text.length);
    });

    it('returns startPos <= endPos for all headings', () => {
      const text = [
        '# Title',
        'Content',
        '## Section',
        'More content',
        '### Subsection',
      ].join('\n');

      const result = parseHeadings(text);
      for (const heading of result) {
        expect(heading.startPos).toBeLessThanOrEqual(heading.endPos);
        expect(heading.startPos).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles leading whitespace correctly', () => {
      const text = '  Điều 1 Phạm vi';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].startPos).toBe(2); // after 2 spaces
    });
  });

  describe('Edge cases', () => {
    it('returns empty array for empty text', () => {
      expect(parseHeadings('')).toEqual([]);
    });

    it('returns empty array for text with no headings', () => {
      const text = 'This is just regular text without any headings or patterns.';
      expect(parseHeadings(text)).toEqual([]);
    });

    it('does not match numbered pattern without title text', () => {
      // A bare number without following text should not be treated as a heading
      const text = '42';
      expect(parseHeadings(text)).toEqual([]);
    });

    it('Vietnamese patterns take priority over numbered sections', () => {
      // "Điều 1 Title" should match as Vietnamese legal, not as numbered "1"
      const text = 'Điều 1 Phạm vi điều chỉnh';
      const result = parseHeadings(text);
      expect(result).toHaveLength(1);
      expect(result[0].level).toBe(4); // Điều level, not numbered section level
      expect(result[0].identifier).toBe('Điều 1');
    });

    it('headings are returned in document order', () => {
      const text = [
        '## Second level',
        '# First level',
        '### Third level',
      ].join('\n');

      const result = parseHeadings(text);
      expect(result).toHaveLength(3);
      // Should be in document order, not sorted by level
      expect(result[0].level).toBe(2);
      expect(result[1].level).toBe(1);
      expect(result[2].level).toBe(3);

      // Positions should be increasing
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startPos).toBeGreaterThan(result[i - 1].startPos);
      }
    });
  });
});
