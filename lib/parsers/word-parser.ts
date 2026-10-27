import * as mammoth from 'mammoth';
import { DocumentParser, ParseResult } from './interface';
import { Logger } from '../logger';

const logger = new Logger({ service: 'word-parser' });


export class WordParser implements DocumentParser {
  canHandle(mimeType: string, extension: string): boolean {
    const validMimeTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    return validMimeTypes.includes(mimeType) || ['.docx', '.doc'].includes(extension.toLowerCase());
  }

  async parse(fileBuffer: Buffer, fileName: string): Promise<ParseResult> {
    try {
      // Extract raw text
      const resultText = await mammoth.extractRawText({ buffer: fileBuffer });
      const text = resultText.value;
      
      // We can also extract to HTML, and then we might optionally convert to markdown.
      // But text from mammoth handles basic paragraphs well enough for llms.
      // We will provide text as both text and markdown. 
      // If we need rich markdown from word, we'd use a turndown service on the html result.
      
      return {
        text: text,
        markdown: text, // Fallback to raw text for markdown
        metadata: {
          messages: resultText.messages
        }
      };
    } catch (e) {
      logger.error('[parse] Error parsing Word file', { fileName }, e);
      throw e;
    }
  }
}
