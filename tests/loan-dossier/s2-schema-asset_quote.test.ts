// T-DOC-24 — schema zod asset_quote (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('asset_quote', ['CUSTOMER', 'OWNER']);
