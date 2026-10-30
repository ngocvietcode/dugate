// Tính lại từ `case_input.json` (case_corrections.md COR-R02, R03, R14; T-COR-05). Không lưu trạng thái: mọi thứ cần nằm trong file
// (D-01, D-02). Lỗi đầu vào → Error("INVALID_INPUT: <MÃ> — <đường dẫn>"), không có giá trị trong message (D-07).
import { CaseInputSchema, type CaseInput, type Correction, type CorrectionReport } from '@/lib/loan-dossier/corrections/schema';
import { createHash } from 'crypto';

import { canonicalJson, verifyCaseSeal } from '@/lib/loan-dossier/corrections/seal';
import { getStorageBackend } from '@/lib/storage';

import { isDossierPrecheck, skippedPrecheck, type DossierPrecheck } from './dossier-precheck';
import type { ClassifyCheckpoint, ExtractCheckpoint } from './dossier-stages';

export const CASE_INPUT_FILE = 'case_input.json';
const MAX_CASE_INPUT_BYTES = 20 * 1024 * 1024;

type FileRef = { name: string; path: string; mime: string; size: number };

const isJson = (f: FileRef) => f.name.toLowerCase().endsWith('.json') || f.mime === 'application/json';

/** File case input của lần chạy, null khi là lần chạy thường. Lẫn file khác → lỗi (COR-R02). */
export function findCaseInputFile(files: ReadonlyArray<FileRef>): FileRef | null {
  const json = files.filter(isJson);
  if (json.length === 0) return null;
  if (json.length > 1 || files.length > 1) throw new Error('INVALID_INPUT: CASE_INPUT_MIXED — files[] chỉ được gồm đúng một file case_input.json');
  return json[0];
}

async function readFileText(file: FileRef): Promise<string> {
  if (file.size > MAX_CASE_INPUT_BYTES) throw new Error('INVALID_INPUT: INVALID_CASE_INPUT — case_input.json vượt 20 MB');
  const stream = await (await getStorageBackend()).download(file.path);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > MAX_CASE_INPUT_BYTES) throw new Error('INVALID_INPUT: INVALID_CASE_INPUT — case_input.json vượt 20 MB');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Parse + kiểm schema + kiểm niêm phong. Không có giá trị nào trong message lỗi. */
export function parseCaseInput(text: string): CaseInput {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('INVALID_INPUT: INVALID_CASE_INPUT — case_input.json không phải JSON'); }
  const parsed = CaseInputSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(gốc)'))].slice(0, 20);
    throw new Error(`INVALID_INPUT: INVALID_CASE_INPUT — ${paths.join(', ')}`);
  }
  const input = parsed.data;
  if (input.dossier_precheck !== null && !isDossierPrecheck(input.dossier_precheck)) throw new Error('INVALID_INPUT: INVALID_CASE_INPUT — dossier_precheck');
  if (!verifyCaseSeal(input.case_seal, input.documents, input.dossier_precheck)) throw new Error('INVALID_INPUT: CASE_SEAL_INVALID — case_seal');
  return input;
}

export async function loadCaseInput(file: FileRef): Promise<CaseInput> {
  return parseCaseInput(await readFileText(file));
}

/** Checkpoint stage 0–1 dựng từ case input (spike T-COR-05): có `precheck` để không gọi lại LLM, có marker giai đoạn 1 để không dừng. */
export function checkpointsFromCase(input: CaseInput): { classify: ClassifyCheckpoint; extract: ExtractCheckpoint } {
  const precheck: DossierPrecheck = (input.dossier_precheck as DossierPrecheck | null) ?? skippedPrecheck('Tính lại từ case_input: Operation nguồn không có kiểm tra sơ bộ.');
  return {
    classify: {
      files: input.documents.classify.files,
      repeated_doc_types: input.documents.classify.repeated_doc_types,
      stage_status: 'SUCCESS', status_code: 'RECOMPUTED_FROM_CASE_INPUT', message: null, file_refs: {},
      precheck,
      intake_phase1: { version: '1.0' },
    } as ClassifyCheckpoint,
    extract: { evidences: input.documents.evidences, stage_status: 'SUCCESS', status_code: 'RECOMPUTED_FROM_CASE_INPUT', message: null } as ExtractCheckpoint,
  };
}

export const byKind = <K extends Correction['kind']>(cs: ReadonlyArray<Correction>, ...kinds: K[]) =>
  cs.filter((c): c is Extract<Correction, { kind: K }> => (kinds as string[]).includes(c.kind));

export function correctionsSha256(cs: ReadonlyArray<Correction>): string {
  return createHash('sha256').update(canonicalJson(cs), 'utf8').digest('hex');
}

export function mergeReports(source_operation_id: string, parts: ReadonlyArray<Pick<CorrectionReport, 'applied' | 'skipped'>>): CorrectionReport {
  return { source_operation_id, applied: parts.flatMap((p) => p.applied), skipped: parts.flatMap((p) => p.skipped) };
}

