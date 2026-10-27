// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs từ catalog/data/doc_schemas/goods_purchase_contract.schema.json — KHÔNG sửa tay.
// T-DOC-12 — goods_purchase_contract (Hợp đồng mua bán hàng hóa)
import { z } from 'zod';

import {
  DocumentPartySchema,
  LegalInfoSchema,
  NullableDateSchema,
  NullableMoneySchema,
} from '../common-schema';

const Party = DocumentPartySchema.extend({
  party_role: z.enum(["SELLER", "BUYER"]),
  ownership: z.null(),
});

export const GoodsPurchaseContractDataSchema = z.object({
  parties: z.array(Party).min(2),
  contract_info: z.object({
  contract_number: z.string().nullable(),
  sign_date: NullableDateSchema,
  total_amount: NullableMoneySchema,
  payment_terms_raw: z.string().nullable(),
  delivery_terms_raw: z.string().nullable(),
}).strict(),
  goods_summary: z.object({
  goods_description: z.string().nullable(),
  items: z.array(z.object({
  item_no: z.number().int().min(0).nullable(),
  item_name: z.string().nullable(),
  unit: z.string().nullable(),
  quantity: z.number().min(0).nullable(),
  unit_price: NullableMoneySchema,
  amount: NullableMoneySchema,
}).strict()),
}).strict(),
  legal_info: LegalInfoSchema.nullable(),
}).strict();
export type GoodsPurchaseContractData = z.infer<typeof GoodsPurchaseContractDataSchema>;
