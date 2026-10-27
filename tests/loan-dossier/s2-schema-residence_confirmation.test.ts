// T-DOC-04 — schema zod residence_confirmation (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('residence_confirmation', ['HOLDER', 'HOUSEHOLD_MEMBER']);
