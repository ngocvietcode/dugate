// T-DOC-22 — schema zod real_estate_valuation_report (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('real_estate_valuation_report', ['CUSTOMER', 'OWNER']);
