export interface ParseResult {
  text: string;
  markdown: string;
  metadata?: {
    pageCount?: number;
    sheetNames?: string[];
    wordCount?: number;
    [key: string]: any;
  };
}

export interface DocumentParser {
  /**
   * Determine if this parser can handle the given file
   */
  canHandle(mimeType: string, extension: string): boolean;
  
  /**
   * Parse the document buffer into text and markdown
   */
  parse(fileBuffer: Buffer, fileName: string): Promise<ParseResult>;
}
