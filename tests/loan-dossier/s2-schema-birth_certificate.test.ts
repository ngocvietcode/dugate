// T-DOC-09 — schema zod birth_certificate (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('birth_certificate', ['CHILD', 'FATHER', 'MOTHER']);
