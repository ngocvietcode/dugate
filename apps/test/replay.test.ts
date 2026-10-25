// Replay history thật (ghi từ E2E: RECORD_HISTORIES=1) qua code workflow hiện tại — không cần Temporal server.
// Thay đổi làm workflow không tất định với run đang chạy dở -> test này đỏ -> dùng patched()/worker versioning (constitution §13).
import fs from 'node:fs';
import path from 'node:path';
import { temporal } from '@temporalio/proto';
import { Worker } from '@temporalio/worker';
import { describe, it } from 'vitest';
import { dataConverter, keyRingFromEnv } from '../src/platform/codec';

const ROOT = path.resolve(__dirname, '..');
const VEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'credit-kit', 'contracts', 'codec-vectors.json'), 'utf8'));
const DIR = path.join(ROOT, 'src', 'credit-appraisal-assist', 'histories');

describe('replay histories', () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.history.json'))) {
    it(`replay ${f}`, async () => {
      const rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const history = temporal.api.history.v1.History.decode(Buffer.from(rec.data, 'base64'));
      await Worker.runReplayHistory({
        workflowsPath: path.join(ROOT, 'src', 'workflows.ts'),
        dataConverter: dataConverter(keyRingFromEnv({ APPS_PAYLOAD_KEYS: VEC.keys, APPS_PAYLOAD_KEY_ID: VEC.key_id })),
      }, history, rec.workflowId);
    }, 120_000);
  }
});
