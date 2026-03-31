// app/api/v1/extract/contract/route.ts
// POST /api/v1/extract/contract — Recipe: Extract clauses from legal contracts
// Shortcut for pipeline: [{ processor: "prebuilt-contract", variables: { clauses_focus } }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/extract/contract:
 *   post:
 *     summary: Extract structured clauses and parties from a legal contract
 *     description: |
 *       Recipe shortcut for the `prebuilt-contract` processor.
 *       Extracts: contracting parties, effective date, expiry date, key clauses with summaries,
 *       penalty terms, and total contract value.
 *       Use `clauses_focus` to narrow extraction to specific articles (e.g. "Điều 3,Điều 5").
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
 *                 description: Legal contract document — PDF or DOCX
 *               clauses_focus:
 *                 type: string
 *                 description: Optional comma-separated list of specific clauses to focus on (e.g. "Điều 3,Điều 5,Khoản 2.1")
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains extracted_data with contract structure.
 *       400:
 *         description: Missing file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('extract-contract', req);
}
