// Registry schema zod của 27 loại FULL (T-S2-01, S2-R01). Schema từng loại nằm ở ./schemas/{doc_type_key}.ts,
// sinh bởi `npm run gen:loan-doc-schemas` từ JSON Schema của spec (T-DOC-01…27).
import type { ZodTypeAny } from 'zod';

import { docTypeByKey, loadDocTypes } from '../catalog';
import { DOC_DATA_SCHEMAS } from './schemas';

export const UNKNOWN_DOC_TYPE = 'UNKNOWN_DOC_TYPE';

export class UnknownDocTypeError extends Error {
  readonly code = UNKNOWN_DOC_TYPE;
  constructor(readonly docTypeKey: string, why: string) {
    super(`${UNKNOWN_DOC_TYPE}: ${docTypeKey} — ${why}`);
    this.name = 'UnknownDocTypeError';
  }
}

/** Các loại `extraction_level = FULL` theo `doc_types.json`. */
export function fullDocTypeKeys(): string[] {
  return loadDocTypes().filter((d) => d.extraction_level === 'FULL').map((d) => d.doc_type_key);
}

/** Loại FULL chưa có schema (theo dõi tiến độ T-DOC-*); rỗng khi đủ 27. */
export function notImplementedDocTypes(): string[] {
  return fullDocTypeKeys().filter((k) => !(k in DOC_DATA_SCHEMAS));
}

/** Schema zod của `evidence.data` cho loại FULL; loại LIGHT, loại lạ hoặc chưa có schema → `UnknownDocTypeError`. */
export function getDocSchema(docTypeKey: string): ZodTypeAny {
  const docType = docTypeByKey(docTypeKey);
  if (!docType) throw new UnknownDocTypeError(docTypeKey, 'không có trong doc_types.json');
  if (docType.extraction_level !== 'FULL') throw new UnknownDocTypeError(docTypeKey, 'loại LIGHT, dùng s2/light.ts');
  const schema = DOC_DATA_SCHEMAS[docTypeKey];
  if (!schema) throw new UnknownDocTypeError(docTypeKey, 'notImplemented: chưa có schema');
  return schema;
}
