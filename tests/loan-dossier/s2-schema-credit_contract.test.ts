// T-DOC-27 — schema zod credit_contract (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('credit_contract', ['BORROWER', 'CO_BORROWER', 'LENDER']);
