// mock-service/server.js
// DU Mock External API Service
// Simulates all 15 ExternalApiConnection connectors for pipeline testing.

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const healthRouter = require('./routes/health');
const connectorsRouter = require('./routes/connectors');

const app = express();
const PORT = process.env.MOCK_PORT || 3099;

// ─── TLS material ────────────────────────────────────────────────────────────
// Never checked into the repo: the container entrypoint (docker-entrypoint.sh)
// generates a self-signed pair on first boot, and `npm run certs` does the same
// for a bare-metal run. Paths are overridable so neither location is hardcoded.
const CERT_DIR = process.env.MOCK_CERT_DIR || path.join(__dirname, 'certs');
const KEY_PATH = process.env.MOCK_TLS_KEY || path.join(CERT_DIR, 'mock-service.key');
const CERT_PATH = process.env.MOCK_TLS_CERT || path.join(CERT_DIR, 'mock-service.crt');

function loadTlsMaterial() {
  const missing = [KEY_PATH, CERT_PATH].filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    console.error(`\n❌ DU Mock Service cannot start: TLS material missing.`);
    console.error(`   Not found: ${missing.join(', ')}`);
    console.error(`   Generate it with:  npm run certs`);
    console.error(`   Or override paths: MOCK_TLS_KEY / MOCK_TLS_CERT / MOCK_CERT_DIR\n`);
    process.exit(1);
  }
  return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
}

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
    // Never echo the credential that was sent. A near miss (right key, wrong case
    // or a stray space) would otherwise put almost the whole key in the log.
    // Source and length are enough to debug a mismatch.
    // apiKey and bearerToken already default to '' above, so this cannot be undefined;
    // the trailing || '' only keeps the .length safe if those defaults ever change.
    const received = apiKey || bearerToken || '';
    const source = apiKey ? 'x-api-key' : bearerToken ? 'authorization' : 'none';
    console.warn(`[MOCK] ⚠️  Unauthorized — credential from ${source}, length ${received.length}`);
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
https.createServer(loadTlsMaterial(), app).listen(PORT, () => {
  console.log(`\n🚀 DU Mock Service running on https://0.0.0.0:${PORT}`);
  // Never log the key itself — only whether auth is active.
  console.log(`   Auth key : ${MOCK_API_KEY === 'disabled' ? '<disabled>' : '<set>'}`);
  console.log(`   Delay    : ${process.env.MOCK_DELAY_MS || 300}ms (default)`);
  console.log(`   Endpoints: GET  /health`);
  console.log(`              POST /ext/:slug  (15 connectors)`);
  console.log(`   Scenarios: ?scenario=success|error|timeout\n`);
});
