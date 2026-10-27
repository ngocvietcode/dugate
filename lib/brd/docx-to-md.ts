// lib/brd/docx-to-md.ts
// Convert DOCX buffer → Markdown có cấu trúc (heading / list / bảng / in đậm).
// Dùng mammoth (đã có sẵn) để ra HTML rồi chuyển HTML → Markdown nhẹ, không thêm dependency.

import * as mammoth from 'mammoth';

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Xoá toàn bộ thẻ HTML còn lại và chuẩn hoá khoảng trắng trong 1 ô/đoạn inline. */
function stripInline(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(strong|b)\s*>/gi, '**')
      .replace(/<\s*\/\s*(strong|b)\s*>/gi, '**')
      .replace(/<\s*(em|i)\s*>/gi, '*')
      .replace(/<\s*\/\s*(em|i)\s*>/gi, '*')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '') // bỏ thẻ còn lại
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** Chuyển 1 khối <table> sang Markdown table. */
function convertTable(tableHtml: string): string {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const parsed: string[][] = rows.map((row) => {
    const cells = row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? [];
    return cells.map((c) => stripInline(c.replace(/<\/?t[hd][^>]*>/gi, '')) || ' ');
  });
  if (parsed.length === 0) return '';

  const colCount = Math.max(...parsed.map((r) => r.length));
  const norm = parsed.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push(' ');
    return copy;
  });

  const header = norm[0];
  const sep = header.map(() => '---');
  const bodyRows = norm.slice(1);

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return `\n${lines.join('\n')}\n`;
}

/** Chuyển HTML (từ mammoth) → Markdown. */
export function htmlToMarkdown(html: string): string {
  let out = html;

  // 1) Bảng (xử lý trước khi strip thẻ).
  out = out.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => convertTable(tbl));

  // 2) Heading.
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)</h${i}>`, 'gi');
    out = out.replace(re, (_, inner) => `\n${'#'.repeat(i)} ${stripInline(inner)}\n`);
  }

  // 3) List item.
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${stripInline(inner)}\n`);
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // 4) Paragraph.
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `${stripInline(inner)}\n\n`);

  // 5) Còn sót → strip.
  out = stripInlineKeepBreaks(out);

  // 6) Chuẩn hoá dòng trống.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Như stripInline nhưng giữ lại xuống dòng (cho phần ngoài bảng/heading/list/p). */
function stripInlineKeepBreaks(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(strong|b)\s*>/gi, '**')
      .replace(/<\s*\/\s*(strong|b)\s*>/gi, '**')
      .replace(/<\s*(em|i)\s*>/gi, '*')
      .replace(/<\s*\/\s*(em|i)\s*>/gi, '*')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n'),
  );
}

/**
 * Convert DOCX buffer → Markdown.
 * Ưu tiên convertToHtml (giữ cấu trúc) → htmlToMarkdown.
 * Nếu lỗi, fallback extractRawText (text thuần).
 */
export async function docxBufferToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const md = htmlToMarkdown(html || '');
    if (md.trim()) return md;
  } catch {
    /* rơi xuống fallback */
  }
  const { value: text } = await mammoth.extractRawText({ buffer });
  return (text || '').trim();
}
