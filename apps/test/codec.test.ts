import fs from 'node:fs';
import path from 'node:path';
import type { Payload } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { AesGcmCodec, keyRingFromEnv } from '../src/platform/codec';

const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'credit-kit', 'contracts', 'codec-vectors.json'), 'utf8'));
const ring = keyRingFromEnv({ APPS_PAYLOAD_KEYS: v.keys, APPS_PAYLOAD_KEY_ID: v.key_id });
const codec = new AesGcmCodec(ring);
const te = new TextEncoder();
const td = new TextDecoder();
const fromVec = (x: { metadata: Record<string, string>; data_b64: string }): Payload => ({
  metadata: Object.fromEntries(Object.entries(x.metadata).map(([k, b]) => [k, new Uint8Array(Buffer.from(b, 'base64'))])),
  data: new Uint8Array(Buffer.from(x.data_b64, 'base64')) });

describe('Payload codec AES-256-GCM', () => {
  it('mã hoá rồi giải mã ra đúng payload; bản mã không chứa chuỗi gốc', async () => {
    const p: Payload = { metadata: { encoding: te.encode('json/plain') }, data: te.encode('{"cccd":"001192012345"}') };
    const [e] = await codec.encode([p]);
    expect(td.decode(e.metadata!.encoding)).toBe('binary/encrypted');
    expect(Buffer.from(e.data!).toString('latin1')).not.toContain('001192012345');
    const [d] = await codec.decode([e]);
    expect(td.decode(d.data!)).toBe('{"cccd":"001192012345"}');
  });

  it('giải mã được vector do worker Python tạo', async () => {
    const [d] = await codec.decode([fromVec(v.from_python)]);
    expect(td.decode(d.data!)).toBe(v.plain.data_utf8);
    expect(td.decode(d.metadata!.encoding)).toBe('json/plain');
  });

  it('xoay khoá: khoá mới mã hoá, khoá cũ vẫn giải mã được', async () => {
    const newKey = Buffer.alloc(32, 7).toString('base64');
    const ring2 = keyRingFromEnv({ APPS_PAYLOAD_KEYS: `${v.keys},k2:${newKey}`, APPS_PAYLOAD_KEY_ID: 'k2' });
    const c2 = new AesGcmCodec(ring2);
    const [old] = await codec.encode([{ metadata: {}, data: te.encode('x') }]);
    expect(td.decode((await c2.decode([old]))[0].data!)).toBe('x');
    const [fresh] = await c2.encode([{ metadata: {}, data: te.encode('y') }]);
    expect(td.decode(fresh.metadata!['encryption-key-id'])).toBe('k2');
  });

  it('sửa một byte bản mã -> giải mã thất bại (toàn vẹn)', async () => {
    const [e] = await codec.encode([{ metadata: {}, data: te.encode('abc') }]);
    e.data![20] ^= 1;
    await expect(codec.decode([e])).rejects.toThrow();
  });

  it('khoá sai độ dài bị từ chối', () => {
    expect(() => keyRingFromEnv({ APPS_PAYLOAD_KEYS: 'a:AAAA' })).toThrow(/32 byte/);
  });
});
