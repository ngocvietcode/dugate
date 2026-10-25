import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeOp { id: string; key: string; form: Record<string, string>; files: Record<string, string>; service: string;
  polls: number; state: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; result?: unknown }

/** Core giả cho test: /api/v1/docs/:service (multipart) và /api/v1/operations/:id, idempotency theo header. */
export async function startFakeCore(opts: {
  apiKey?: string;
  respond?: (service: string, form: Record<string, string>, files: Record<string, string>) =>
    { content?: string; extracted_data?: unknown } | 'FAIL';
  pollsUntilDone?: number;
  rejectStatus?: number;
} = {}) {
  const ops = new Map<string, FakeOp>();
  const byKey = new Map<string, string>();
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (opts.apiKey && req.headers['x-api-key'] !== opts.apiKey) return send(401, { detail: 'bad key' });
    const url = new URL(req.url ?? '/', 'http://x');
    const m = url.pathname.match(/^\/api\/v1\/docs\/(\w+)$/);
    if (m && req.method === 'POST') {
      if (opts.rejectStatus) return send(opts.rejectStatus, { detail: 'rejected' });
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const fd = await new Response(Buffer.concat(chunks), { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
      const form: Record<string, string> = {};
      const files: Record<string, string> = {};
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') form[k] = v; else files[v.name] = await v.text();
      }
      const key = String(req.headers['idempotency-key'] ?? '');
      if (key && byKey.has(key)) return send(200, view(ops.get(byKey.get(key)!)!));
      const id = `op_${++n}`;
      const r = opts.respond?.(m[1], form, files) ?? { content: 'ok' };
      ops.set(id, { id, key, form, files, service: m[1], polls: 0, state: r === 'FAIL' ? 'FAILED' : 'RUNNING',
        result: r === 'FAIL' ? undefined : r });
      if (key) byKey.set(key, id);
      return send(202, view(ops.get(id)!));
    }
    const o = url.pathname.match(/^\/api\/v1\/operations\/(\w+)$/);
    if (o && req.method === 'GET') {
      const op = ops.get(o[1]);
      if (!op) return send(404, { detail: 'not found' });
      op.polls++;
      if (op.state === 'RUNNING' && op.polls >= (opts.pollsUntilDone ?? 1)) op.state = 'SUCCEEDED';
      return send(200, view(op));
    }
    send(404, { detail: 'no route' });
  });
  const view = (op: FakeOp) => ({ name: `operations/${op.id}`, done: op.state !== 'RUNNING', metadata: { state: op.state },
    ...(op.state === 'SUCCEEDED' ? { result: { ...(op.result as object), usage: { input_tokens: 10, output_tokens: 5, model_used: 'ext:fake', cost_usd: 0.001 } } } : {}),
    ...(op.state === 'FAILED' ? { error: { code: 'X', message: 'connector failed' } } : {}) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  /** Tạo sẵn một Operation đã xong (vd đầu ra DU v5 của hồ sơ). */
  const seed = (id: string, extracted: unknown) => {
    ops.set(id, { id, key: '', form: {}, files: {}, service: 'seed', polls: 0, state: 'SUCCEEDED', result: { extracted_data: extracted } });
  };
  return { url: `http://127.0.0.1:${port}`, ops, seed, close: () => new Promise<void>((r) => server.close(() => r())) };
}
