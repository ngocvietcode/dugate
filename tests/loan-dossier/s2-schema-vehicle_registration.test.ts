// T-DOC-20 — schema zod vehicle_registration (DoD chung: S2 §7).
import { describeDocSchema } from './fixtures/doc-schema-suite';

describeDocSchema('vehicle_registration', ['OWNER']);
