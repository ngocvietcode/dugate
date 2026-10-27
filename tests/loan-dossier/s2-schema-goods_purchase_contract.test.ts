// T-DOC-12 — schema zod goods_purchase_contract (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('goods_purchase_contract', ['SELLER', 'BUYER']);
