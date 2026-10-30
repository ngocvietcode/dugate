// Niêm phong `documents` của kết quả loan-appraisal (COR-R03). Lần tính lại chỉ nhận OCR mà chính DUGate đã trả: không có niêm phong
// thì `case_input.json` thành đường gửi OCR tùy ý mà kết quả vẫn mang nhãn "OCR của DUGate". Hàm thuần trừ việc đọc khóa từ env.
import { createHmac, hkdfSync, timingSafeEqual } from 'crypto';

import { CASE_INPUT_CONTRACT, CASE_INPUT_VERSION, type CaseDocuments, type CaseSeal } from './schema';

const SEAL_INFO = 'dugate/loan-case-seal/v1';

export interface SealSubject {
  source_operation_id: string;
  product_code: string;
  flow: string | null;
  workflow_version: string;
  documents: CaseDocuments;
  dossier_precheck: Record<string, unknown> | null;
}

/** JSON với khóa object sắp xếp, không khoảng trắng; mảng giữ thứ tự. `undefined` trong object bị bỏ như JSON.stringify. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/** Khóa HMAC dẫn xuất từ ENCRYPTION_KEY (cùng nguồn với lib/crypto) bằng HKDF, tách khỏi khóa mã hóa at-rest. */
function sealKey(): Buffer {
  const material = process.env.ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!material) throw new Error('[case-seal] ENCRYPTION_KEY (or NEXTAUTH_SECRET) env var is not set.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.alloc(0), Buffer.from(SEAL_INFO, 'utf8'), 32));
}

function macOf(subject: SealSubject): string {
  const payload = canonicalJson({
    contract: CASE_INPUT_CONTRACT,
    contract_version: CASE_INPUT_VERSION,
    source_operation_id: subject.source_operation_id,
    product_code: subject.product_code,
    flow: subject.flow,
    workflow_version: subject.workflow_version,
    documents: subject.documents,
    dossier_precheck: subject.dossier_precheck,
  });
  return createHmac('sha256', sealKey()).update(payload, 'utf8').digest('hex');
}

export function sealCase(subject: SealSubject): CaseSeal {
  return {
    alg: 'HMAC-SHA256',
    key_id: 'v1',
    source_operation_id: subject.source_operation_id,
    product_code: subject.product_code,
    flow: subject.flow,
    workflow_version: subject.workflow_version,
    mac: macOf(subject),
  };
}

/** true khi `seal` được DUGate ký cho đúng `documents` + `dossier_precheck`. Không ném lỗi với seal hỏng. */
export function verifyCaseSeal(seal: CaseSeal, documents: CaseDocuments, dossier_precheck: Record<string, unknown> | null): boolean {
  if (seal.alg !== 'HMAC-SHA256' || seal.key_id !== 'v1' || !/^[0-9a-f]{64}$/.test(seal.mac)) return false;
  const expected = Buffer.from(macOf({ ...seal, documents, dossier_precheck }), 'hex');
  const supplied = Buffer.from(seal.mac, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
