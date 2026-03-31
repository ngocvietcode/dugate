// app/api/v1/generate/summary/route.ts
// POST /api/v1/generate/summary — Recipe: Summarize a document
// Shortcut for pipeline: [{ processor: "prebuilt-summarize", variables: { max_words } }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/generate/summary:
 *   post:
 *     summary: Generate a concise summary of a document
 *     description: |
 *       Recipe shortcut for the `prebuilt-summarize` processor.
 *       Produces a clear, professional summary of the document content, preserving key facts and figures.
 *       Control output length with `max_words` (default: 500 words).
 *     tags: [Generate]
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
 *                 description: Document to summarize — PDF or DOCX
 *               max_words:
 *                 type: integer
 *                 default: 500
 *                 description: Maximum word count for the summary
 *               output_format:
 *                 type: string
 *                 enum: [md, html]
 *                 default: md
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains content with the summary text.
 *       400:
 *         description: Missing file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('generate-summary', req);
}
