// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/cic.schema.json — KHÔNG sửa tay.
// T-DOC-26 — cic (Báo cáo thông tin tín dụng CIC (KH vay / người đồng vay / chủ TSBĐ))
import { z } from 'zod';

import {
  DateTimeStringSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["HOLDER"]),
  ownership: z.null(),
});

export const CicDataSchema = z.object({
  parties: z.array(Party).min(1),
  reports: z.array(z.object({
  party_index: z.number().int().min(0),
  report_datetime: DateTimeStringSchema.nullable(),
  cic_code: z.string().nullable(),
  current_debt_group: z.number().int().min(1).max(5).nullable(),
  current_debt_group_raw: z.string().nullable(),
  bad_debt_5y: z.object({
  has_records: z.boolean().nullable(),
  records_raw: z.string().nullable(),
}).strict(),
  card_late_payment_3y: z.object({
  has_records: z.boolean().nullable(),
  records_raw: z.string().nullable(),
}).strict(),
  watchlist_debt_12m: z.object({
  has_records: z.boolean().nullable(),
  records_raw: z.string().nullable(),
}).strict(),
  queried_institutions_1y_count: z.number().int().min(0).nullable(),
  queried_institutions: z.array(z.object({
  institution: z.string().nullable(),
  query_date: NullableDateSchema,
}).strict()),
}).strict()).min(1),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type CicData = z.infer<typeof CicDataSchema>;
