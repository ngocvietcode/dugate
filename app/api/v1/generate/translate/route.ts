// app/api/v1/generate/translate/route.ts
// POST /api/v1/generate/translate — Recipe: Translate a document
// Shortcut for pipeline: [{ processor: "prebuilt-translate", variables: { target_language, tone } }]

import { NextRequest } from 'next/server';
import { runEndpoint } from '@/lib/endpoints/runner';

/**
 * @swagger
 * /api/v1/generate/translate:
 *   post:
 *     summary: Translate a document to a target language
 *     description: |
 *       Recipe shortcut for the `prebuilt-translate` processor.
 *       Translates the full document content while preserving all Markdown formatting
 *       (headings, tables, lists, bold, italic, code blocks).
 *       Supported targets include any language the underlying AI model supports
 *       (e.g. "Tiếng Việt", "English", "Japanese", "French", "Chinese Simplified").
 *     tags: [Generate]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, target_language]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document to translate — PDF or DOCX
 *               target_language:
 *                 type: string
 *                 description: 'Target language for translation (e.g. "Tiếng Việt", "English", "Japanese")'
 *                 example: Tiếng Việt
 *               tone:
 *                 type: string
 *                 enum: [formal, casual, technical]
 *                 default: formal
 *                 description: Translation tone/register
 *               output_format:
 *                 type: string
 *                 enum: [md, html]
 *                 default: md
 *               webhook_url:
 *                 type: string
 *                 description: Optional URL for async completion notification
 *     responses:
 *       202:
 *         description: Operation created. Result contains content with the translated document.
 *       400:
 *         description: Missing file or target_language
 */
export async function POST(req: NextRequest) {
  return runEndpoint('generate-translate', req);
}
