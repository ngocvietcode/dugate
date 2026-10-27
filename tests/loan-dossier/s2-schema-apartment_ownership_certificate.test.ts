// T-DOC-18 — schema zod apartment_ownership_certificate (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('apartment_ownership_certificate', ['OWNER']);
