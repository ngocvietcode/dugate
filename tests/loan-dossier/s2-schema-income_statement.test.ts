// T-DOC-16 — schema zod income_statement (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('income_statement', ['BORROWER', 'CO_BORROWER']);
