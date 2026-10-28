// Dựng hồ sơ 360 cho test giống workflow (S3 → LAC → profile360). Dữ liệu giả, không PII thật.
import type { MapDossierData } from '@/lib/loan-dossier/contracts/check-stages';
import { buildLoanApplicationContext } from '@/lib/loan-dossier/context/build';
import { buildProfile360 } from '@/lib/loan-dossier/profile360/build';
import type { MergePolicies } from '@/lib/loan-dossier/profile360/policies';
import type { Profile360 } from '@/lib/loan-dossier/profile360/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import type { EvidenceEnvelope } from '@/lib/loan-dossier/s2/common-schema';

export const D0 = '2026-10-14';

/** `s3`: bỏ trống → chạy S3 thật; `null` → mô phỏng S3 lỗi. */
export function profileOf(
  evidences: EvidenceEnvelope[],
  opts: { s3?: MapDossierData | null; segment?: string; policies?: MergePolicies | null } = {},
): Profile360 {
  const s3 = opts.s3 === undefined ? runMapDossier({ evidences, dossier_submitted_at: D0 }).data : opts.s3;
  const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: s3 ? 'SUCCESS' : null });
  return buildProfile360({ evidences, s3, lac, segment: opts.segment ?? 'HKD', ...(opts.policies === undefined ? {} : { policies: opts.policies }) });
}
