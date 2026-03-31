// lib/endpoints/registry.ts
// Centralized registry for all dynamic endpoints in the system.

export type InputMode = 'single_file' | 'two_files' | 'no_file';

export interface EndpointDef {
  slug: string;
  displayName: string;
  route: string;
  description: string;
  inputMode: InputMode;
  defaultOutputFormat?: string;

  // Parameters that clients are allowed to send/override (can have defaults via ProfileEndpoint)
  clientParams: string[];

  // Parameters that are STRICTLY FORBIDDEN from clients. Only set by Admin via ProfileEndpoint (business_rules, etc.)
  profileOnlyParams: string[];

  // Ordered list of processor slugs (Local Processors or ExternalApiConnections) to execute
  connections: string[];
}

export const ENDPOINT_REGISTRY: Record<string, EndpointDef> = {
  // ── 1. Transformation & Utility (Local Processors) ──
  'transform': {
    slug: 'transform',
    displayName: 'Document Transformation',
    route: 'POST /api/v1/transform',
    description: 'Convert PDF or DOCX files into Markdown, HTML or raw Text.',
    inputMode: 'single_file',
    clientParams: ['output_format'],
    profileOnlyParams: [],
    connections: ['prebuilt-layout'],
  },
  'compare': {
    slug: 'compare',
    displayName: 'Document Comparison',
    route: 'POST /api/v1/compare',
    description: 'Perform a semantic diff between a source and target document.',
    inputMode: 'two_files',
    clientParams: [],
    profileOnlyParams: [],
    connections: ['prebuilt-compare'],
  },

  // ── 2. Information Extraction (LLM-based via External Pipelines) ──
  'fact-check': {
    slug: 'fact-check',
    displayName: 'Fact Checking (2-step pipeline)',
    route: 'POST /api/v1/fact-check',
    description: 'Extract claims from document and verify them against reference data.',
    inputMode: 'single_file',
    clientParams: ['reference_data', 'extract_fields'],
    profileOnlyParams: ['business_rules'],
    connections: ['ext-claim-extractor', 'ext-fact-verifier'],
  },
  'extract-invoice': {
    slug: 'extract-invoice',
    displayName: 'Invoice Extraction',
    route: 'POST /api/v1/extract/invoice',
    description: 'Parse structured data from invoices and receipts.',
    inputMode: 'single_file',
    clientParams: [],
    profileOnlyParams: ['business_rules'],
    connections: ['ext-invoice-extractor'],
  },
  'extract-contract': {
    slug: 'extract-contract',
    displayName: 'Contract Data Extraction',
    route: 'POST /api/v1/extract/contract',
    description: 'Extract parties, terms, signatures and clauses from legal contracts.',
    inputMode: 'single_file',
    clientParams: [],
    profileOnlyParams: ['business_rules'],
    connections: ['ext-contract-extractor'],
  },
  'extract-id-card': {
    slug: 'extract-id-card',
    displayName: 'ID Card Data Extraction',
    route: 'POST /api/v1/extract/id-card',
    description: 'Extract PII data from Identity Cards or Passports.',
    inputMode: 'single_file',
    clientParams: [],
    profileOnlyParams: ['business_rules'],
    connections: ['ext-id-card-extractor'],
  },
  'extract-classify': {
    slug: 'extract-classify',
    displayName: 'Document Classification',
    route: 'POST /api/v1/extract/classify',
    description: 'Classify the input document into a predefined list of categories.',
    inputMode: 'single_file',
    clientParams: ['categories'],
    profileOnlyParams: ['business_rules'], // e.g. custom handling rules
    connections: ['ext-document-classifier'],
  },

  // ── 3. Generative Tasks (LLM-based via External Pipelines) ──
  'generate-summary': {
    slug: 'generate-summary',
    displayName: 'Text Summarization',
    route: 'POST /api/v1/generate/summary',
    description: 'Generate an executive summary of the document.',
    inputMode: 'single_file',
    clientParams: ['max_words', 'output_format'],
    profileOnlyParams: ['tone', 'focus_areas'],
    connections: ['ext-summarize'],
  },
  'generate-translate': {
    slug: 'generate-translate',
    displayName: 'Document Translation',
    route: 'POST /api/v1/generate/translate',
    description: 'Translate the document while preserving formatting.',
    inputMode: 'single_file',
    clientParams: ['target_language'],
    profileOnlyParams: ['glossary'],
    connections: ['ext-translate'],
  },
};
