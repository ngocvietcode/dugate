// lib/parsers/pdf-parser.ts
// ── DEPRECATED: Not registered in ParserFactory ─────────────────────────────
// pdf-parse bundles pdfjs-dist which requires full browser canvas APIs at
// runtime: DOMMatrix (with methods like .multiply, .translate, .transformPoint),
// ImageData, Path2D — none of which can be safely stubbed in Node.js.
// PDFs are forwarded directly to the External API connector instead.
// This file is kept for reference only. Do NOT import PdfParser into factory.ts.

import { DocumentParser, ParseResult } from './interface';
import { Logger } from '../logger';

const logger = new Logger({ service: 'pdf-parser' });


// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

export class PdfParser implements DocumentParser {
  canHandle(mimeType: string, extension: string): boolean {
    return mimeType === 'application/pdf' || extension.toLowerCase() === '.pdf';
  }

  async parse(fileBuffer: Buffer, fileName: string): Promise<ParseResult> {
    try {
      const data = await pdfParse(fileBuffer, {
        // max 0 means no limit
        max: 0
      });

      const text = data.text || '';

      // Fallback Strategy: if the PDF has pages but the extracted text is suspiciously short,
      // it might be a scanned PDF or contains only images.
      // We throw a specific error so the Factory can switch to external OCR API.
      const textLength = text.trim().length;
      if (data.numpages > 0 && textLength < data.numpages * 50) {
        throw new Error('SCANNED_PDF_DETECTED');
      }

      return {
        text: text,
        markdown: text, // Plain text as markdown
        metadata: {
          pageCount: data.numpages,
          info: data.info,
          version: data.version,
        },
      };
    } catch (e) {
      logger.error('[parse] Error parsing PDF file', { fileName }, e);
      throw e;
    }
  }
}
