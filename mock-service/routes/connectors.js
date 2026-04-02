// mock-service/routes/connectors.js
// POST /ext/:slug — Dispatcher for all 15 DU connectors.
// Supports: ?scenario=success|error|timeout and ?delay=<ms>

'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

// Use memory storage — we don't actually save files
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Map slug → response builder module
const CONNECTOR_MODULES = {
  'ext-doc-layout':    require('../responses/ext-doc-layout'),
  'ext-vision-reader': require('../responses/ext-vision-reader'),
  'ext-pdf-tools':     require('../responses/ext-pdf-tools'),
  'ext-data-extractor':require('../responses/ext-data-extractor'),
  'ext-classifier':    require('../responses/ext-classifier'),
  'ext-sentiment':     require('../responses/ext-sentiment'),
  'ext-compliance':    require('../responses/ext-compliance'),
  'ext-fact-verifier': require('../responses/ext-fact-verifier'),
  'ext-quality-eval':  require('../responses/ext-quality-eval'),
  'ext-translator':    require('../responses/ext-translator'),
  'ext-rewriter':      require('../responses/ext-rewriter'),
  'ext-redactor':      require('../responses/ext-redactor'),
  'ext-content-gen':   require('../responses/ext-content-gen'),
  'ext-qa-engine':     require('../responses/ext-qa-engine'),
  'ext-comparator':    require('../responses/ext-comparator'),
};

const DEFAULT_DELAY_MS = parseInt(process.env.MOCK_DELAY_MS || '300', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Main dispatcher ─────────────────────────────────────────────────────────
router.post('/:slug', upload.any(), async (req, res) => {
  const { slug } = req.params;
  const scenario  = req.query.scenario || 'success';
  const delayMs   = parseInt(req.query.delay || DEFAULT_DELAY_MS, 10);

  // ── 1. Validate slug ──────────────────────────────────────────────────────
  const connectorModule = CONNECTOR_MODULES[slug];
  if (!connectorModule) {
    return res.status(404).json({
      error: 'Connector Not Found',
      message: `Slug '${slug}' is not registered. Valid slugs: ${Object.keys(CONNECTOR_MODULES).join(', ')}`,
      mock: true,
    });
  }

  // ── 2. Parse multipart fields ─────────────────────────────────────────────
  const fields = {};
  if (req.body) {
    Object.assign(fields, req.body);
  }

  // Collect uploaded files info (we don't process actual content)
  const files = (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
  }));

  const primaryFilename = files[0]?.originalname || 'document.pdf';

  console.log(`[MOCK] → ${slug} | files: ${files.length} | scenario: ${scenario} | delay: ${delayMs}ms`);
  if (files.length > 0) {
    files.forEach((f, i) => console.log(`         file[${i}]: ${f.originalname} (${f.mimetype}, ${f.size} bytes)`));
  }

  // ── 3. Simulate delay ─────────────────────────────────────────────────────
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  // ── 4. Handle scenarios ───────────────────────────────────────────────────
  if (scenario === 'timeout') {
    console.log(`[MOCK] ⏳ Timeout scenario for ${slug} — sleeping 130s`);
    await sleep(130_000); // Longer than max timeout (120s) in seed
    return res.status(504).json({ error: 'Gateway Timeout', mock: true });
  }

  if (scenario === 'error') {
    console.log(`[MOCK] ❌ Error scenario for ${slug}`);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: `[Mock] Simulated error for connector '${slug}'`,
      mock: true,
    });
  }

  if (scenario === 'empty') {
    // Returns valid response but with empty content — tests edge case handling
    return res.json({ content: '', mock: true });
  }

  // ── 5. Build and return response ──────────────────────────────────────────
  try {
    const response = connectorModule.buildResponse(fields, files, primaryFilename);
    console.log(`[MOCK] ✅ ${slug} → content: ${String(response.content).length} chars`);
    return res.json(response);
  } catch (err) {
    console.error(`[MOCK] ❌ Error building response for ${slug}:`, err.message);
    return res.status(500).json({
      error: 'Mock Build Error',
      message: err.message,
      mock: true,
    });
  }
});

module.exports = router;
