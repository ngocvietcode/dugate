// `build_master_dossier` (MD-R01): hàm thuần, tất định, không gọi model, không log giá trị.
import type { CheckChecklistData, CrossCheckData, MapDossierData } from '../contracts/check-stages';
import type { MasterDossier } from '../contracts/master-dossier';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { buildDossierGraph } from '../graph';
import { buildDocuments } from './document';
import { buildEntities } from './entity';

export interface MasterDossierInput {
  evidences: ReadonlyArray<EvidenceEnvelope>;
  s3: MapDossierData | null;
  checklist: CheckChecklistData | null;
  crossCheck: CrossCheckData | null;
  program_key?: string | null;
  product_code?: string | null;
  flow?: string | null;
}

export function buildMasterDossier(input: MasterDossierInput): MasterDossier {
  const { documents, other_documents } = buildDocuments({ evidences: input.evidences, s3: input.s3, checklist: input.checklist });
  // Một DossierGraph dựng một lần từ S3; entity đọc từ graph thay vì tra lại ba mảng song song của S3.
  const graph = input.s3 ? buildDossierGraph(input.s3) : null;
  const { persons, assets } = buildEntities(input.evidences, graph, input.crossCheck?.results ?? [], [...documents, ...other_documents]);
  const fields = [...documents, ...other_documents].flatMap((d) => d.fields);
  const count = (s: string) => fields.filter((f) => f.status === s).length;
  return {
    master_version: '1.0',
    program_key: input.checklist?.program_key ?? input.program_key ?? null,
    product_code: input.checklist?.product_code ?? input.product_code ?? null,
    flow: input.checklist?.flow ?? input.flow ?? null,
    documents,
    other_documents,
    persons,
    assets,
    summary: {
      documents_total: documents.length,
      documents_present: documents.filter((d) => d.copies.some((c) => c.role === 'PRIMARY')).length,
      fields_total: fields.length,
      agreed: count('AGREED'),
      ocr_normalized: count('OCR_NORMALIZED'),
      single_source: count('SINGLE_SOURCE'),
      conflict: count('CONFLICT'),
      missing: count('MISSING'),
      corrected: count('CORRECTED'),
    },
  };
}

/** MD-AC12: lỗi dựng master không làm đổ workflow — trả null + lý do (không chứa giá trị trường). */
export function tryBuildMasterDossier(input: MasterDossierInput): { master: MasterDossier | null; warning: string | null } {
  try {
    return { master: buildMasterDossier(input), warning: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { master: null, warning: `MASTER_DOSSIER_UNAVAILABLE: không dựng được master_dossier (${name}); rule dùng dữ liệu OCR từng bản.` };
  }
}
