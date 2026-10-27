// Bóc tách nhẹ (LIGHT) cho 20 loại chỉ nhận diện (T-S2-10, S2-R20): `data = {parties, legal_info, fields}`.
// Schema dựng từ `light_extraction.json`: party dùng DocumentParty chung, legal_info dùng LegalInfo,
// `fields` strict đúng key của loại, kiểu theo `value_type`.
import { z, type ZodTypeAny } from 'zod';

import { docTypeByKey, loadLightExtraction, type LightDocType } from '../catalog';
import {
  AddressSchema, DocumentPartySchema, LegalInfoSchema, NullableDateSchema, NullableMoneySchema,
} from './common-schema';
import { describeZodError, successResult, type EvidenceResult } from './evidence-result';
import { parseWithSalvage } from './salvage';
import { UnknownDocTypeError } from './schema-registry';

const VALUE_TYPE_SCHEMA: Record<LightDocType['fields'][number]['value_type'], ZodTypeAny> = {
  TEXT: z.string().nullable(),
  DATE: NullableDateSchema,
  MONEY: NullableMoneySchema,
  ADDRESS: AddressSchema.nullable(),
};

function lightDoc(docTypeKey: string): LightDocType {
  const docType = docTypeByKey(docTypeKey);
  if (!docType) throw new UnknownDocTypeError(docTypeKey, 'không có trong doc_types.json');
  if (docType.extraction_level !== 'LIGHT') throw new UnknownDocTypeError(docTypeKey, 'loại FULL, dùng schema-registry');
  const light = loadLightExtraction().find((d) => d.doc_type_key === docTypeKey);
  if (!light) throw new UnknownDocTypeError(docTypeKey, 'thiếu trong light_extraction.json');
  return light;
}

/** Vị trí party chủ thể (đúng `subject_party_role` + `subject_party_type`), -1 nếu không có. */
function subjectIndex(light: LightDocType, parties: ReadonlyArray<{ party_role: string; party_type: string }>): number {
  return parties.findIndex((p) => p.party_role === light.subject_party_role && p.party_type === light.subject_party_type);
}

const schemaCache = new Map<string, ZodTypeAny>();

/** Schema zod của `data` loại LIGHT; loại FULL hoặc loại lạ → `UnknownDocTypeError`. */
export function lightSchema(docTypeKey: string): ZodTypeAny {
  const cached = schemaCache.get(docTypeKey);
  if (cached) return cached;
  const light = lightDoc(docTypeKey);
  const fields = z.object(Object.fromEntries(light.fields.map((f) => [f.key, VALUE_TYPE_SCHEMA[f.value_type]]))).strict();
  const schema = z.object({
    parties: z.array(DocumentPartySchema).min(1).superRefine((parties, ctx) => {
      if (subjectIndex(light, parties) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `cần ≥ 1 party chủ thể ${light.subject_party_role}/${light.subject_party_type}`,
        });
      }
    }),
    legal_info: LegalInfoSchema.nullable(),
    fields,
  }).strict();
  schemaCache.set(docTypeKey, schema);
  return schema;
}

/**
 * Kiểm kết quả model cho loại LIGHT (schema mềm S2-R21). Không cứu được → ERROR/UNREADABLE_CONTENT;
 * field sai định dạng → SUCCESS/FIELD_FORMAT_INVALID; chủ thể không có tên → SUCCESS/REQUIRED_FIELD_UNREADABLE.
 */
export function validateLight(docTypeKey: string, raw: unknown): EvidenceResult {
  const light = lightDoc(docTypeKey);
  const parsed = parseWithSalvage(lightSchema(docTypeKey), raw);
  if (!parsed.success) {
    return { status: 'ERROR', reason_code: 'UNREADABLE_CONTENT', message: describeZodError(parsed.error), data: null };
  }
  const data = parsed.data as { parties: Array<{ party_role: string; party_type: string; full_name: string | null }> } & Record<string, unknown>;
  const i = subjectIndex(light, data.parties);
  return successResult(data, data.parties[i].full_name === null ? [`parties.${i}.full_name`] : [], parsed.invalid_fields);
}

/** JSON Schema của `data` loại LIGHT để đưa vào prompt (dùng `$defs` của _common.schema.json như loại FULL). */
export function lightJsonSchema(docTypeKey: string): Record<string, unknown> {
  const light = lightDoc(docTypeKey);
  const ref = (name: string) => ({ $ref: `_common.schema.json#/$defs/${name}` });
  const VALUE_TYPE_JSON: Record<LightDocType['fields'][number]['value_type'], unknown> = {
    TEXT: { type: ['string', 'null'] }, DATE: ref('NullableDate'), MONEY: ref('NullableMoney'), ADDRESS: ref('NullableAddress'),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['parties', 'legal_info', 'fields'],
    properties: {
      parties: { type: 'array', minItems: 1, items: ref('DocumentParty') },
      legal_info: ref('NullableLegalInfo'),
      fields: {
        type: 'object',
        additionalProperties: false,
        required: light.fields.map((f) => f.key),
        properties: Object.fromEntries(light.fields.map((f) => [f.key, VALUE_TYPE_JSON[f.value_type]])),
      },
    },
  };
}

/** Đặc tả cho prompt bóc tách nhẹ: đúng key `fields` và vai trò chủ thể của loại. */
export function lightPromptSpec(docTypeKey: string): string {
  const light = lightDoc(docTypeKey);
  const docType = docTypeByKey(docTypeKey)!;
  const typeHint: Record<string, string> = {
    TEXT: 'chuỗi nguyên văn', DATE: 'ngày ISO YYYY-MM-DD', MONEY: 'số nguyên VND', ADDRESS: 'object {full_text, street, ward, district, province}',
  };
  const lines = [
    `Chứng từ: ${docType.doc_type_label} (${docTypeKey}). Trả JSON {parties, legal_info, fields}.`,
    `parties: ≥ 1 party chủ thể party_role = ${light.subject_party_role}, party_type = ${light.subject_party_type}; đủ field DocumentParty, field không có trên giấy = null.`,
    'legal_info: theo LegalInfo; issue_date = ngày cấp/ký nếu có.',
    light.fields.length
      ? `fields: đúng các key sau, không thêm key khác:\n${light.fields.map((f) => `- ${f.key} (${f.label}): ${typeHint[f.value_type]} hoặc null`).join('\n')}`
      : 'fields: {} (loại này không có trường riêng).',
  ];
  if (light.note) lines.push(`Lưu ý: ${light.note}`);
  return lines.join('\n');
}
