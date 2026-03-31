// app/api/v1/compare/route.ts
// POST /api/v1/compare — Recipe: Semantic diff between 2 documents
// Shortcut for pipeline: [{ processor: "prebuilt-compare" }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/compare:
 *   post:
 *     summary: Compare two documents semantically
 *     description: |
 *       Recipe shortcut for the `prebuilt-compare` processor.
 *       Performs an AI-powered semantic diff between two PDF or DOCX files.
 *       Returns a structured list of added, removed, and modified sections with significance scores.
 *     tags: [Compare]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [source_file, target_file]
 *             properties:
 *               source_file:
 *                 type: string
 *                 format: binary
 *                 description: Original (baseline) document — PDF or DOCX
 *               target_file:
 *                 type: string
 *                 format: binary
 *                 description: Revised document to compare against the source — PDF or DOCX
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Poll GET /api/v1/operations/{id} for result. Result contains extracted_data with differences array.
 *       400:
 *         description: Missing source_file or target_file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('compare', req);
}
