// T-DOC-19 — schema zod land_use_cert_to_buy (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('land_use_cert_to_buy', ['OWNER']);
