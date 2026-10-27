// T-DOC-15 — schema zod salary_confirmation (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('salary_confirmation', ['EMPLOYER', 'EMPLOYEE']);
