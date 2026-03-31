// app/api/v1/extract/id-card/route.ts
// POST /api/v1/extract/id-card — Recipe: Extract data from Vietnamese ID cards
// Shortcut for pipeline: [{ processor: "prebuilt-id-card" }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/extract/id-card:
 *   post:
 *     summary: Extract structured data from a Vietnamese ID card (CCCD/CMND)
 *     description: |
 *       Recipe shortcut for the `prebuilt-id-card` processor.
 *       Extracts machine-readable fields from a scanned Vietnamese National ID card (Căn cước công dân / Chứng minh nhân dân):
 *       full name, date of birth, gender, ID number, place of origin, place of residence, expiry date.
 *       Accepts PDF, DOCX, JPEG, or PNG inputs.
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
 *                 description: ID card scan — PDF, DOCX, JPEG, or PNG
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains extracted_data with ID card fields.
 *       400:
 *         description: Missing file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('extract-id-card', req);
}
