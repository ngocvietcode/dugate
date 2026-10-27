// T-DOC-23 — schema zod movable_asset_valuation_report (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('movable_asset_valuation_report', ['CUSTOMER', 'OWNER']);
