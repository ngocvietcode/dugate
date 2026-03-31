// app/api/v1/transform/route.ts
// POST /api/v1/transform — Recipe: PDF/DOCX → Markdown or HTML
// Shortcut for pipeline: [{ processor: "prebuilt-layout" }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/transform:
 *   post:
 *     summary: Convert PDF/DOCX to Markdown or HTML
 *     description: |
 *       Recipe shortcut for the `prebuilt-layout` processor.
 *       Converts a PDF or DOCX file to well-structured Markdown (or HTML),
 *       preserving headings, tables, lists, and image references.
 *     tags: [Transform]
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
 *                 description: PDF or DOCX file to convert
 *               output_format:
 *                 type: string
 *                 enum: [md, html]
 *                 default: md
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Poll GET /api/v1/operations/{id} for result.
 *       400:
 *         description: Missing or invalid file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('transform', req);
}
