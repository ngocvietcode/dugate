// T-DOC-13 — schema zod vehicle_sale_contract (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('vehicle_sale_contract', ['SELLER', 'BUYER']);
