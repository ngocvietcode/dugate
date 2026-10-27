// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/purchase_list.schema.json — KHÔNG sửa tay.
// T-DOC-11 — purchase_list (Bảng kê mua hàng)
import { z } from 'zod';

import {
  AddressSchema,
  DocumentPartySchema,
  LegalInfoSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["CUSTOMER", "SELLER"]),
  ownership: z.null(),
});

export const PurchaseListDataSchema = z.object({
  parties: z.array(Party).min(1),
  business_info: z.object({
  business_line: z.string().nullable(),
  business_address: AddressSchema.nullable(),
}).strict().nullable(),
  funding_plan: z.object({
  total_amount: NullableMoneySchema,
  loan_amount: NullableMoneySchema,
  own_capital_amount: NullableMoneySchema,
}).strict(),
  items: z.array(z.object({
  item_no: z.number().int().min(0).nullable(),
  item_name: z.string().nullable(),
  unit: z.string().nullable(),
  quantity: z.number().min(0).nullable(),
  unit_price: NullableMoneySchema,
  amount: NullableMoneySchema,
}).strict()),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type PurchaseListData = z.infer<typeof PurchaseListDataSchema>;
