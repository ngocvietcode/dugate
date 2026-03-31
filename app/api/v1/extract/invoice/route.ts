// app/api/v1/extract/invoice/route.ts
// POST /api/v1/extract/invoice — Recipe: Extract structured data from invoices
// Shortcut for pipeline: [{ processor: "prebuilt-invoice" }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/extract/invoice:
 *   post:
 *     summary: Extract structured data from a VAT invoice
 *     description: |
 *       Recipe shortcut for the `prebuilt-invoice` processor.
 *       Extracts machine-readable fields from a PDF or DOCX invoice:
 *       invoice number, date, seller/buyer info, line items, totals, tax amounts, currency.
 *       Result is returned as `extracted_data` JSON in the operation response.
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
 *                 description: Invoice document — PDF or DOCX
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains extracted_data with invoice fields.
 *       400:
 *         description: Missing file
 */
export async function POST(req: NextRequest) {
  return runEndpoint('extract-invoice', req);
}
