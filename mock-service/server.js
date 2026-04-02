// mock-service/server.js
// DU Mock External API Service
// Simulates all 15 ExternalApiConnection connectors for pipeline testing.

'use strict';

const express = require('express');
const morgan = require('morgan');
const healthRouter = require('./routes/health');
const connectorsRouter = require('./routes/connectors');

const app = express();
const PORT = process.env.MOCK_PORT || 3099;

// ─── Logging ────────────────────────────────────────────────────────────────
app.use(morgan(':method :url :status :response-time ms — :res[content-length] bytes'));

// ─── Auth Middleware ─────────────────────────────────────────────────────────
const MOCK_API_KEY = process.env.MOCK_API_KEY || 'DUMMY_SECRET_KEY';

app.use('/ext', (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || '';
  const bearerMatch = (req.headers['authorization'] || '').match(/^Bearer (.+)$/);
  const bearerToken = bearerMatch ? bearerMatch[1] : '';

  // Accept either x-api-key or Authorization: Bearer
  if (MOCK_API_KEY !== 'disabled' && apiKey !== MOCK_API_KEY && bearerToken !== MOCK_API_KEY) {
    console.warn(`[MOCK] ⚠️  Unauthorized — key received: "${apiKey || bearerToken}"`);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key. Send x-api-key header.',
      mock: true,
    });
  }
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/ext', connectorsRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Path '${req.path}' not found. Valid paths: GET /health, POST /ext/:slug`,
    mock: true,
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 DU Mock Service running on http://0.0.0.0:${PORT}`);
  console.log(`   Auth key : ${MOCK_API_KEY}`);
  console.log(`   Delay    : ${process.env.MOCK_DELAY_MS || 300}ms (default)`);
  console.log(`   Endpoints: GET  /health`);
  console.log(`              POST /ext/:slug  (15 connectors)`);
  console.log(`   Scenarios: ?scenario=success|error|timeout\n`);
});
