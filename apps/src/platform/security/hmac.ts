import crypto from 'node:crypto';

/** Chữ ký webhook: hex(HMAC-SHA256(secret, `${timestamp}.${body}`)). Bên nhận kiểm bằng verifySignature. */
export function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifySignature(secret: string, timestamp: string, body: string, header: string,
  { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) } = {}): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const want = Buffer.from(`sha256=${sign(secret, timestamp, body)}`);
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
