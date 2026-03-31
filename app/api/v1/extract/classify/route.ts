// app/api/v1/extract/classify/route.ts
// POST /api/v1/extract/classify — Recipe: Classify document type
// Shortcut for pipeline: [{ processor: "prebuilt-classify", variables: { labels } }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/extract/classify:
 *   post:
 *     summary: Classify a document into a type category
 *     description: |
 *       Recipe shortcut for the `prebuilt-classify` processor.
 *       Automatically identifies the document type (invoice, contract, resume, report, letter, form, regulation, other),
 *       along with confidence score, detected language, estimated page count, and key topics.
 *       Provide custom `labels` to override the default classification taxonomy.
 *     tags: [Extract]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document to classify — PDF or DOCX
 *               labels:
 *                 type: string
 *                 description: 'Optional comma-separated custom classification labels (e.g. "policy,memo,sop,guideline")'
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains extracted_data with document_type, confidence, language, key_topics.
 *       400:
 *         description: Missing file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('extract-classify', req);
}
