// Thêm vector mã hoá từ phía TypeScript vào credit-kit/contracts/codec-vectors.json (chạy một lần khi đổi định dạng).
import fs from 'node:fs';
import path from 'node:path';
import { AesGcmCodec, keyRingFromEnv } from '../src/platform/codec';

const file = path.join(__dirname, '..', 'credit-kit', 'contracts', 'codec-vectors.json');
const v = JSON.parse(fs.readFileSync(file, 'utf8'));
const codec = new AesGcmCodec(keyRingFromEnv({ APPS_PAYLOAD_KEYS: v.keys, APPS_PAYLOAD_KEY_ID: v.key_id }));
codec.encode([{ metadata: { encoding: new TextEncoder().encode(v.plain.metadata.encoding) },
  data: new TextEncoder().encode(v.plain.data_utf8) }]).then(([p]) => {
  v.from_typescript = {
    metadata: Object.fromEntries(Object.entries(p.metadata ?? {}).map(([k, b]) => [k, Buffer.from(b).toString('base64')])),
    data_b64: Buffer.from(p.data ?? []).toString('base64'),
  };
  fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n');
});
