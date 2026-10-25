// Client gọi dugate Core qua API công khai /api/v1/docs/* (constitution L2). Không import code Core.

export const DISCRIMINATOR: Record<CoreService, string> = {
  ingest: 'mode', extract: 'type', analyze: 'task', transform: 'action', generate: 'task', compare: 'mode',
};
export type CoreService = 'ingest' | 'extract' | 'analyze' | 'transform' | 'generate' | 'compare';

export interface FileUrlEntry { url: string; filename?: string; mime_type?: string }
export interface InlineFile { name: string; content: string; type: string }

export interface SubmitRequest {
  service: CoreService;
  sub: string;                       // giá trị discriminator, vd extract: 'custom'
  params?: Record<string, string>;   // tham số form khác (schema, fields, categories...)
  fileUrls?: FileUrlEntry[];
  files?: InlineFile[];              // file nhỏ do App tạo (vd bản trích LAC), gửi multipart files[]
  idempotencyKey: string;
  correlationId?: string;
}

/** Operation theo định dạng AIP-151 của Core (lib/pipelines/format.ts). */
export interface CoreOperation {
  name: string;
  done: boolean;
  metadata: { state: string; progress_percent?: number; progress_message?: string | null };
  result?: {
    content?: string | null;
    extracted_data?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number; model_used?: string | null; cost_usd?: number };
  };
  error?: { code?: string | null; message?: string | null };
}

export class CoreClientError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = 'CoreClientError';
  }
}

export interface CoreClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class CoreClient {
  private readonly f: typeof fetch;
  constructor(private readonly o: CoreClientOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    return { 'x-api-key': this.o.apiKey, accept: 'application/json', ...extra };
  }

  private async call(url: string, init: RequestInit): Promise<CoreOperation> {
    let res: Response;
    try {
      res = await this.f(url, { ...init, signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000) });
    } catch (e) {
      throw new CoreClientError(`không gọi được Core: ${(e as Error).message}`, null, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try { detail = (JSON.parse(text) as { detail?: string }).detail ?? detail; } catch { /* giữ text */ }
      // 4xx (trừ 408/429) là lỗi của yêu cầu: thử lại không giúp gì
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      throw new CoreClientError(`Core ${res.status}: ${detail}`, res.status, retryable);
    }
    return JSON.parse(text) as CoreOperation;
  }

  async submit(r: SubmitRequest): Promise<CoreOperation> {
    const form = new FormData();
    form.set(DISCRIMINATOR[r.service], r.sub);
    for (const [k, v] of Object.entries(r.params ?? {})) form.set(k, v);
    if (r.fileUrls?.length) form.set('file_urls', JSON.stringify(r.fileUrls));
    for (const f of r.files ?? []) form.append('files[]', new Blob([f.content], { type: f.type }), f.name);
    return this.call(`${this.o.baseUrl}/api/v1/docs/${r.service}`, {
      method: 'POST', body: form,
      headers: this.headers({ 'idempotency-key': r.idempotencyKey, ...(r.correlationId ? { 'x-correlation-id': r.correlationId } : {}) }),
    });
  }

  async getOperation(id: string): Promise<CoreOperation> {
    return this.call(`${this.o.baseUrl}/api/v1/operations/${encodeURIComponent(id)}`, { method: 'GET', headers: this.headers({}) });
  }
}

export const operationId = (op: CoreOperation) => op.name.replace(/^operations\//, '');
