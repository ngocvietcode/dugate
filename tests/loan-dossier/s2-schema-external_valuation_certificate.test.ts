// T-DOC-25 — schema zod external_valuation_certificate (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('external_valuation_certificate', ['CUSTOMER', 'OWNER']);
