// T-DOC-11 — schema zod purchase_list (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('purchase_list', ['CUSTOMER', 'SELLER']);
