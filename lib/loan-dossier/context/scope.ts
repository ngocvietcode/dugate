// Phạm vi LAC mà một bộ rule cần (LAC-R11; D-103). Khóa mới `lac.*` và ánh xạ khóa cũ (`evidence.*`, `master_data.*`,
// `master.*`) để rule đã lưu trên Profile không phải sửa. Hàm thuần.
import type { LacFact, LacSubject } from './schema';

export interface LacScope {
  /** true = rule không khai nguồn nào nhận biết được → toàn bộ LAC (vẫn trong ngân sách). */
  all: boolean;
  loan: boolean;
  business: boolean;
  /** null = không lấy người; rỗng = mọi người; có phần tử = chỉ người có một trong các vai trò đó. */
  personRoles: Set<string> | null;
  /** null = không lấy tài sản; rỗng = mọi tài sản; có phần tử = chỉ tài sản có một trong các mục đích đó. */
  assetUsages: Set<string> | null;
  relations: boolean;
  /** Fact có nguồn thuộc các loại chứng từ này (mọi chủ thể) — từ `evidence.<doc>`, `ocr.<doc>` và `lac.document.<doc>`. */
  docTypes: Set<string>;
  /** `master_data.income`: thêm fact `income_sources` của người. */
  personIncome: boolean;
}

const empty = (): LacScope => ({ all: false, loan: false, business: false, personRoles: null, assetUsages: null, relations: false, docTypes: new Set(), personIncome: false });
const addSet = (current: Set<string> | null, value: string | null): Set<string> => {
  if (current && current.size === 0) return current; // đã lấy tất cả
  if (value === null) return new Set();
  return new Set([...(current ?? []), value]);
};

/** Phạm vi từ `input` của các rule LLM đang bật. Chỉ một rule không khai được gì cũng làm phạm vi thành toàn bộ. */
export function lacScopeFromInputs(inputsPerCheck: ReadonlyArray<ReadonlyArray<string>>): LacScope {
  const scope = empty();
  for (const inputs of inputsPerCheck) {
    let recognized = false;
    for (const raw of inputs) {
      const src = raw.trim();
      const lac = src.match(/^lac\.(loan|business|person|asset|relations|document)(?:\.([a-z0-9_]+))?$/);
      if (lac) {
        recognized = true;
        const [, part, sub] = lac;
        if (part === 'loan') scope.loan = true;
        else if (part === 'business') scope.business = true;
        else if (part === 'person') scope.personRoles = addSet(scope.personRoles, sub ?? null);
        else if (part === 'asset') scope.assetUsages = addSet(scope.assetUsages, sub ?? null);
        else if (part === 'relations') scope.relations = true;
        else if (part === 'document' && sub) scope.docTypes.add(sub);
        continue;
      }
      // `ocr.<doc>` (D-120) kéo thêm OCR thô của loại đó vào phụ lục; dữ kiện LAC của cùng loại cũng vào phạm vi.
      const evidence = src.match(/^(?:evidence|ocr)\.([a-z0-9_]+)$/);
      if (evidence) { recognized = true; scope.docTypes.add(evidence[1]); continue; }
      const master = src.match(/^master_data\.([a-z]+)/);
      if (master) {
        recognized = true;
        const group = master[1];
        if (group === 'identity') scope.personRoles = addSet(scope.personRoles, null);
        else if (group === 'collateral') { scope.assetUsages = addSet(scope.assetUsages, null); scope.relations = true; }
        else if (group === 'relationship' || group === 'legal') scope.relations = true;
        else if (group === 'income') { scope.business = true; scope.personIncome = true; }
        else recognized = false;
        continue;
      }
      const md = src.match(/^master\.(person|asset|document)/);
      if (md) {
        recognized = true;
        if (md[1] === 'person') scope.personRoles = addSet(scope.personRoles, null);
        else if (md[1] === 'asset') scope.assetUsages = addSet(scope.assetUsages, null);
        else scope.all = true; // mục checklist của master_dossier không có tương ứng 1–1 trong LAC
      }
    }
    if (!recognized) scope.all = true;
  }
  return scope;
}

export function subjectInScope(scope: LacScope, s: LacSubject): boolean {
  if (scope.all) return true;
  switch (s.kind) {
    case 'loan': return scope.loan;
    case 'business': return scope.business;
    case 'person': return scope.personRoles !== null && (scope.personRoles.size === 0 || s.roles.some((r) => scope.personRoles!.has(r.split(':')[0])));
    case 'asset': return scope.assetUsages !== null && (scope.assetUsages.size === 0 || s.roles.some((r) => scope.assetUsages!.has(r)));
    case 'document': return false;
  }
}

export function factInScope(scope: LacScope, f: LacFact, subject: LacSubject | undefined): boolean {
  if (scope.all) return true;
  if (subject && subjectInScope(scope, subject)) return true;
  if (f.sources.some((s) => scope.docTypes.has(s.doc_type_key))) return true;
  return scope.personIncome && subject?.kind === 'person' && f.field.startsWith('income_sources');
}
