// T-DOC-17 — schema zod land_use_certificate (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('land_use_certificate', ['OWNER']);
