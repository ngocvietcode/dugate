// T-DOC-08 — schema zod marriage_certificate (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('marriage_certificate', ['HUSBAND', 'WIFE']);
