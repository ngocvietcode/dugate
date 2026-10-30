// T-COR-04 — FACT_RESOLUTION và OCR_FIX trong LAC, render và rào rule LLM (COR-R07, R09, R10, R11; COR-AC05, COR-AC06).
import { buildLoanApplicationContext, type BuildLacInput } from '@/lib/loan-dossier/context/build';
import { renderLoanApplicationContext } from '@/lib/loan-dossier/context/render';
import { lacScopeFromInputs } from '@/lib/loan-dossier/context/scope';
import type { FactResolution } from '@/lib/loan-dossier/corrections/schema';
import { runMapDossier } from '@/lib/loan-dossier/s3/run';
import { parseCheckSet } from '@/lib/pipelines/workflows/loan-appraisal/check-set';
import { buildEvidenceRegistryV3 } from '@/lib/pipelines/workflows/loan-appraisal/evidence-v3';
import { parsePromptCheckResults } from '@/lib/pipelines/workflows/loan-appraisal/prompt-checks';

import { ev, ID_A12, loanApp } from './fixtures/dossier';

const OTHER_ID = '079199912345';
const app = loanApp([{ party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 }]);
const card = ev('id_card', { parties: [{ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: OTHER_ID }] });
const evidences = [app, card];
const s3 = runMapDossier({ evidences, dossier_submitted_at: '2026-10-14' }).data;
const appId = `${app.evidence_id}#parties[0].id_number`;
const cardId = `${card.evidence_id}#parties[0].id_number`;

function build(extra: Partial<BuildLacInput> = {}) {
  let report: { applied: unknown[]; skipped: Array<{ correction_id: string; code: string }> } = { applied: [], skipped: [] };
  const lac = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS', onResolutionReport: (r) => { report = r; }, ...extra });
  return { lac, report };
}
const resolution = (chosen: string, record_ids = [appId, cardId], extra: Partial<FactResolution> = {}): FactResolution => ({
  correction_id: 'r1', kind: 'FACT_RESOLUTION', record_ids, chosen_record_id: chosen, reason: 'đã đối chiếu bản gốc', corrected_by: 'u1', corrected_at: '2026-10-30T09:00:00Z', ...extra,
});
const factOf = (lac: ReturnType<typeof build>['lac'], recordId: string) => lac.facts.find((f) => f.sources.some((s) => s.record_id === recordId))!;
const render = (lac: ReturnType<typeof build>['lac']) => renderLoanApplicationContext(lac, lacScopeFromInputs([['lac.person']]));

describe('FACT_RESOLUTION', () => {
  it('nền: hai số định danh khác nhau → DISPUTED, có MÂU THUẪN', () => {
    const { lac } = build();
    expect(factOf(lac, appId).trust).toBe('DISPUTED');
    expect(lac.conflicts).toHaveLength(1);
  });

  it('không có hiệu chỉnh → LAC và text render như khi không truyền tham số', () => {
    const plain = buildLoanApplicationContext({ product_code: 'hkd-loan', flow: 'FULL', evidences, s3, s3_status: 'SUCCESS' });
    expect(build({ resolutions: [], edited_record_ids: [] }).lac).toEqual(plain);
    expect(render(build().lac).text).toBe(render(plain).text);
  });

  it('COR-AC05: chọn số trên CCCD → hết mâu thuẫn, fact chọn SINGLE_SOURCE, fact bị bác OVERRULED, prompt có mục HIỆU CHỈNH', () => {
    const { lac, report } = build({ resolutions: [resolution(cardId)] });
    const chosen = factOf(lac, cardId);
    const overruled = factOf(lac, appId);
    expect(chosen).toMatchObject({ trust: 'SINGLE_SOURCE', adjudication: { correction_id: 'r1', role: 'CHOSEN' }, contradicts: [] });
    expect(overruled).toMatchObject({ trust: 'OVERRULED', adjudication: { role: 'OVERRULED' } });
    expect(lac.conflicts).toEqual([]);
    expect(lac.resolutions).toEqual([{ correction_id: 'r1', subject_id: chosen.subject_id, field: chosen.field, chosen_fact_id: chosen.fact_id, overruled_fact_ids: [overruled.fact_id] }]);
    expect(report).toEqual({ applied: [{ correction_id: 'r1', kind: 'FACT_RESOLUTION' }], skipped: [] });
    const text = render(lac).text;
    expect(text).toContain('HIỆU CHỈNH CỦA NGƯỜI THẨM ĐỊNH');
    expect(text).toMatch(new RegExp(`chọn F\\d+ "${OTHER_ID}"`));
    expect(text).not.toContain('đã đối chiếu bản gốc');
    expect(text).not.toContain('r1');
    expect(text).not.toMatch(new RegExp(`^F\\d+ .*= ${ID_A12} `, 'm'));
  });

  it('COR-AC05: PASS dẫn record của giá trị bị bác (qua mã gốc) → REVIEW / EVIDENCE_DISPUTED', () => {
    const { lac } = build({ resolutions: [resolution(cardId)] });
    const evidence = buildEvidenceRegistryV3(evidences, new Set(), null);
    const { checkSet } = parseCheckSet({ checks: [{ id: 'X.ID', kind: 'PROMPT', prompt: 'p', input: ['lac.person'], threshold: 0.8 }] }, 'FULL', 'hkd-loan');
    const [r] = parsePromptCheckResults({ results: [{ id: 'X.ID', status: 'PASS', confidence: 0.95, reason: 'ok', evidence_ids: [appId] }] }, checkSet, evidence, { render: { refIndex: new Map() }, ocr: null }, lac);
    expect(r).toMatchObject({ result: 'REVIEW', reason_code: 'PROMPT_CHECK_EVIDENCE_DISPUTED' });
  });

  it('COR-AC06: chọn giá trị chỉ có trên đơn vay → DECLARED', () => {
    const { lac } = build({ resolutions: [resolution(appId)] });
    expect(factOf(lac, appId).trust).toBe('DECLARED');
  });

  it('RESOLUTION_ORPHAN, RESOLUTION_STALE (khác trường), DUPLICATE_TARGET', () => {
    const nameId = `${card.evidence_id}#parties[0].full_name`;
    const { lac, report } = build({ resolutions: [
      resolution(cardId, [cardId, `${card.evidence_id}#parties[9].id_number`], { correction_id: 'o1' }),
      resolution(cardId, [cardId, nameId], { correction_id: 's1' }),
      resolution(cardId, undefined, { correction_id: 'old', corrected_at: '2026-10-30T08:00:00Z' }),
      resolution(appId, undefined, { correction_id: 'new', corrected_at: '2026-10-30T10:00:00Z' }),
    ] });
    expect(report.skipped.map((s) => [s.correction_id, s.code])).toEqual([['o1', 'RESOLUTION_ORPHAN'], ['s1', 'RESOLUTION_STALE'], ['old', 'DUPLICATE_TARGET']]);
    expect(factOf(lac, appId).adjudication?.correction_id).toBe('new');
  });
});

describe('OCR_FIX trong LAC', () => {
  it('lá đã sửa: origin HUMAN_EDIT, read_confidence 1.0, dòng prompt có "đã sửa đọc"; lá khác giữ nguyên', () => {
    const { lac } = build({ edited_record_ids: [cardId] });
    const src = factOf(lac, cardId).sources.find((s) => s.record_id === cardId)!;
    expect(src).toMatchObject({ origin: 'HUMAN_EDIT', read_confidence: 1 });
    const nameSrc = factOf(lac, `${card.evidence_id}#parties[0].full_name`).sources.find((s) => s.record_id.startsWith(card.evidence_id))!;
    expect(nameSrc.origin).toBeUndefined();
    expect(render(lac).text).toContain('đã sửa đọc');
  });
});
