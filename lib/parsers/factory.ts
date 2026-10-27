import { DocumentParser } from './interface';
import { ExcelParser } from './excel-parser';
import { WordParser } from './word-parser';
// NOTE: PdfParser (pdf-parse/pdfjs-dist) is excluded from internal parsers because
// pdfjs-dist requires browser canvas APIs (DOMMatrix, Path2D, ImageData) that
// cannot be safely polyfilled in Node.js server environments.
// PDF files are routed directly to the External API connector instead.

export class ParserFactory {
  private static parsers: DocumentParser[] = [
    new ExcelParser(),
    new WordParser(),
    // PdfParser intentionally omitted — PDFs → External API
  ];

  /**
   * Retrieves a suitable internal parser for the file
   */
  static getParserForFile(mimeType: string, fileName: string): DocumentParser | null {
    // extract extension
    const parts = fileName.split('.');
    const ext = parts.length > 1 ? `.${parts[parts.length - 1]}`.toLowerCase() : '';
    
    // find a parser that can handle this file
    for (const parser of this.parsers) {
      if (parser.canHandle(mimeType, ext)) {
        return parser;
      }
    }
    
    // No internal parser found, must use external API
    return null;
  }
}
