// T-DOC-14 — schema zod labor_contract (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('labor_contract', ['EMPLOYER', 'EMPLOYEE']);
