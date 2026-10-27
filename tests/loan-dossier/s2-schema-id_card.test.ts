// T-DOC-01 — schema zod id_card (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('id_card', ['HOLDER']);
