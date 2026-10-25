// Payload Codec AES-256-GCM — mã hoá mọi payload Temporal (input/output workflow, activity, update) để history
// trong DB Temporal không chứa dữ liệu hồ sơ dạng rõ (constitution §6). Cùng định dạng với
// credit-kit/lac/lac/codec.py để worker Python đọc được.
import crypto from 'node:crypto';
import type { Payload, PayloadCodec } from '@temporalio/common';
import { temporal } from '@temporalio/proto';

const ENCODING = 'binary/encrypted';
const PayloadProto = temporal.api.common.v1.Payload;

export interface KeyRing { current: string; keys: Record<string, Buffer> }

/** APPS_PAYLOAD_KEYS="id1:base64,id2:base64", APPS_PAYLOAD_KEY_ID=id1 (khoá dùng để mã hoá). */
export function keyRingFromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
  const raw = env.APPS_PAYLOAD_KEYS;
  if (!raw) throw new Error('thiếu APPS_PAYLOAD_KEYS (khoá mã hoá payload, lấy từ Vault/KMS)');
  const keys: Record<string, Buffer> = {};
  for (const part of raw.split(',')) {
    const [id, b64] = part.split(':');
    const k = Buffer.from(b64 ?? '', 'base64');
    if (!id || k.length !== 32) throw new Error(`khoá payload '${id}' phải là 32 byte base64`);
    keys[id] = k;
  }
  const current = env.APPS_PAYLOAD_KEY_ID ?? Object.keys(keys)[0];
  if (!keys[current]) throw new Error(`APPS_PAYLOAD_KEY_ID ${current} không có trong APPS_PAYLOAD_KEYS`);
  return { current, keys };
}

const te = new TextEncoder();
const td = new TextDecoder();

export class AesGcmCodec implements PayloadCodec {
  constructor(private readonly ring: KeyRing) {}

  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((p) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', this.ring.keys[this.ring.current], iv);
      const plain = PayloadProto.encode(p).finish();
      const data = Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
      return { metadata: { encoding: te.encode(ENCODING), 'encryption-key-id': te.encode(this.ring.current) }, data };
    });
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((p) => {
      if (!p.metadata || td.decode(p.metadata.encoding) !== ENCODING) return p;
      const id = td.decode(p.metadata['encryption-key-id']);
      const key = this.ring.keys[id];
      if (!key) throw new Error(`không có khoá payload '${id}'`);
      const buf = Buffer.from(p.data ?? new Uint8Array());
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(buf.length - 16));
      const plain = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
      return PayloadProto.decode(plain) as Payload;
    });
  }
}

export const dataConverter = (ring: KeyRing) => ({ payloadCodecs: [new AesGcmCodec(ring)] });
