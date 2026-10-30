// Lớp I/O thuần cho v2: chỉ gọi các endpoint đã có của backend, không đổi contract.

import type { LoanFlow } from '@/app/loan-appraisal/types';

export type ApiErrorKind = 'forbidden' | 'not-found' | 'already-done' | 'http' | 'network' | 'invalid-json';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { 'X-API-Key': apiKey } : {};
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => ({}));
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

function pickMessage(data: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('network', error instanceof Error ? error.message : String(error));
  }
}

export async function submitWorkflow(
  files: File[],
  apiKey: string | undefined,
  productCode: string,
  flow: LoanFlow | undefined,
  signal?: AbortSignal,
  stopAfterIntake = false,
): Promise<string> {
  if (files.length === 0) throw new ApiError('http', 'Cần upload ít nhất 1 tài liệu để thẩm định.');
  const formData = new FormData();
  formData.append('process', 'loan-appraisal');
  formData.append('product_code', productCode);
  if (flow) formData.append('flow', flow);
  // D-51/D-53: backend mặc định dừng sau giai đoạn 1 khi không truyền, nên luôn gửi giá trị rõ ràng.
  // true: giai đoạn 2 chỉ chạy khi người dùng chuyển (resumeOperation); false: chạy hết một lần.
  formData.append('stop_after_intake', stopAfterIntake ? 'true' : 'false');
  files.forEach((file) => formData.append('files[]', file));
  return postWorkflow(formData, apiKey, signal);
}

/** COR-R18: gửi chỉ thị (trong file JSON) cho trợ lý hiệu chỉnh; trả id operation để poll. */
export async function submitCorrectionDraft(file: File, apiKey: string | undefined, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.append('process', 'loan-correction-draft');
  formData.append('files[]', file);
  return postWorkflow(formData, apiKey, signal);
}

async function postWorkflow(formData: FormData, apiKey: string | undefined, signal?: AbortSignal): Promise<string> {
  const response = await request('/api/v1/docs/workflows', {
    method: 'POST',
    body: formData,
    headers: authHeaders(apiKey),
    signal,
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 'forbidden' : 'http',
      pickMessage(data, ['detail', 'message'], `API Error ${response.status}`),
      response.status,
    );
  }
  const name = typeof data.name === 'string' ? data.name.replace('operations/', '') : '';
  const id = name || (typeof data.id === 'string' ? data.id : '');
  if (!id) throw new ApiError('http', 'No operation ID returned', response.status);
  return id;
}

export interface GetOperationOptions {
  apiKey?: string;
  compact?: boolean;
  signal?: AbortSignal;
}

export async function getOperation(id: string, options: GetOperationOptions = {}): Promise<unknown> {
  const url = `/api/v1/operations/${encodeURIComponent(id)}${options.compact ? '?view=compact' : ''}`;
  const response = await request(url, { headers: authHeaders(options.apiKey), signal: options.signal });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      'forbidden',
      'Không có quyền xem operation này. Nhập đúng API key đã dùng khi gửi hồ sơ rồi bấm "Mở lại kết quả".',
      response.status,
    );
  }
  if (response.status === 404) {
    throw new ApiError('not-found', 'Không tìm thấy operation hoặc operation đã bị xoá.', 404);
  }
  const data = await safeJson(response);
  if (!response.ok) {
    throw new ApiError('http', pickMessage(data, ['detail', 'error'], `HTTP ${response.status}`), response.status);
  }
  if (Object.keys(data).length === 0) throw new ApiError('invalid-json', 'Phản hồi không hợp lệ từ máy chủ.', response.status);
  return data;
}

/** Trả về body của phản hồi 200 (đã mang trạng thái CANCELLED). */
export async function cancelOperation(id: string, apiKey?: string, signal?: AbortSignal): Promise<unknown> {
  const response = await request(`/api/v1/operations/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    signal,
  });
  const data = await safeJson(response);
  if (response.ok) return data;
  if (response.status === 409) throw new ApiError('already-done', 'Hồ sơ đã hoàn tất, không thể huỷ.', 409);
  if (response.status === 401 || response.status === 403) {
    throw new ApiError('forbidden', 'Không có quyền huỷ operation này.', response.status);
  }
  if (response.status === 404) throw new ApiError('not-found', 'Không tìm thấy operation.', 404);
  throw new ApiError('http', pickMessage(data, ['detail', 'error', 'message'], `HTTP ${response.status}`), response.status);
}

/** D-51: chạy tiếp giai đoạn 2 của operation đang WAITING_USER_INPUT (dừng sau giai đoạn 1). */
export async function resumeOperation(id: string, apiKey?: string, signal?: AbortSignal): Promise<void> {
  const response = await request(`/api/v1/operations/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });
  if (response.ok) return;
  const data = await safeJson(response);
  if (response.status === 401 || response.status === 403) {
    throw new ApiError('forbidden', 'Không có quyền chạy tiếp operation này. Nhập đúng API key đã dùng khi gửi hồ sơ.', response.status);
  }
  if (response.status === 404) throw new ApiError('not-found', 'Không tìm thấy operation.', 404);
  throw new ApiError('http', pickMessage(data, ['error', 'detail', 'message'], `HTTP ${response.status}`), response.status);
}
