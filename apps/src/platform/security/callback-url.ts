/** Callback chỉ được gửi tới host đã đăng ký (chặn SSRF). Danh sách từ APPS_CALLBACK_ALLOWED_HOSTS. */
export function assertAllowedCallback(url: string, allowedHosts: string[]): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('callback.url không hợp lệ'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) {
    throw new Error('callback.url phải dùng https');
  }
  if (!allowedHosts.includes(u.hostname)) throw new Error(`callback host ${u.hostname} chưa được đăng ký`);
}

export const allowedCallbackHosts = (): string[] =>
  (process.env.APPS_CALLBACK_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
