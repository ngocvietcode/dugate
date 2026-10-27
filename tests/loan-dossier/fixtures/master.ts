// Dựng hồ sơ thật qua S2 nhóm trùng → S3 → S4 → S5 → master (dùng chung cho test master_dossier).
import type { AssetDescriptor, EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';
import { groupDuplicates } from '@/lib/loan-dossier/s2/duplicates';
import { assetKeys } from '@/lib/loan-dossier/s3/asset-key';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { runChecklist } from '@/lib/loan-dossier/s4/run';
import { runCrossCheck } from '@/lib/loan-dossier/s5/run';
import { buildMasterDossier } from '@/lib/loan-dossier/master/build';

import { classifyOf } from './dossier';

const D0 = '2026-10-14';
const now = () => new Date('2026-10-14T03:00:00.000Z');

export async function runDossier(raw: EvidenceEnvelope[], flow = 'FULL') {
  const evidences = groupDuplicates(raw, (a) => assetKeys(a as unknown as AssetDescriptor));
  const s3 = runMapDossier({ evidences, dossier_submitted_at: D0, now });
  const s4 = await runChecklist({
    flow, product_code: 'hkd-loan', dossier_submitted_at: D0,
    external_input: { deviation_code: '', loan_amount: 1_000_000_000, collateral_mortgaged_elsewhere: false },
    classify: classifyOf(evidences), evidences, s3: { status: s3.status, data: s3.data }, now,
  }, { llm: { classifyIncomeSource: async () => ['household_business'], classifyLoanPurpose: async () => ({ vehicle_purchase: 'NO', factory_purchase: 'NO' }) } });
  const s5 = await runCrossCheck({ evidences, s3: { status: s3.status, data: s3.data }, now }, { semantic: null });
  const input = { evidences, s3: s3.data, checklist: s4.data, crossCheck: s5.data };
  return { evidences, s3, s4, s5, input, master: buildMasterDossier(input) };
}
