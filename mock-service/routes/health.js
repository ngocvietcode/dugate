// mock-service/routes/health.js
'use strict';

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'du-mock-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    connectors: [
      'ext-doc-layout',
      'ext-vision-reader',
      'ext-pdf-tools',
      'ext-data-extractor',
      'ext-classifier',
      'ext-sentiment',
      'ext-compliance',
      'ext-fact-verifier',
      'ext-quality-eval',
      'ext-translator',
      'ext-rewriter',
      'ext-redactor',
      'ext-content-gen',
      'ext-qa-engine',
      'ext-comparator',
    ],
    mock: true,
  });
});

module.exports = router;
