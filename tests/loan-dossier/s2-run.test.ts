// T-S2-09 — lắp ráp stage S2 (S2-R02, R03, R14, R20, §4).
import type { ClassifyData } from '@/lib/loan-dossier/contracts/stage-result';
import { ExtractStageResultSchema } from '@/lib/loan-dossier/contracts/stage-result';
import type { ExtractPagesInput } from '@/lib/loan-dossier/s2/extractor-port';
import { evidenceId, runExtract, type ExtractPorts } from '@/lib/loan-dossier/s2/run';
import { docTypeByKey } from '@/lib/loan-dossier/catalog';

import { makeFullData, makeLightData, makeParty } from './fixtures/build';

const FILE_A = 'file-00000000000a';
const FILE_B = 'file-00000000000b';

function classify(files: Array<{ id: string; matches: Array<{ key: string; instances: Array<[number, number]> }> }>): ClassifyData {
  return {
    files: files.map((f) => ({
      file_id: f.id, file_name: `${f.id}.pdf`, status: 'CLASSIFIED', reason_code: null, next_action: null, message: null, page_count: 6,
      matches: f.matches.map((m) => ({
        doc_type_key: m.key, confidence: 0.9, needs_manual_review: false, needs_extraction: docTypeByKey(m.key)!.needs_extraction,
        instances_count: m.instances.length, hint_mismatch: false,
        instances: m.instances.map((page_range, i) => ({ instance_index: i + 1, page_range, confidence: 0.9, summary: '', key_facts: [] })),
      })),
    })),
    repeated_doc_types: [],
  };
}

type Reply = (input: ExtractPagesInput) => unknown;
const okReply: Reply = (input) => ({
  form_found: true,
  data: input.extraction_level === 'FULL' ? makeFullData(input.doc_type_key) : makeLightData(input.doc_type_key),
  field_confidences: { parties: 0.9, legal_info: 0.9 },
  source_pages: { parties: [input.page_range[0]] },
});

function setup(reply: Reply = okReply, extra: Partial<ExtractPorts> = {}) {
  const calls: ExtractPagesInput[] = [];
  const ports: ExtractPorts = {
    readFile: async () => ({ content: Buffer.from('%PDF-1.4'), mime: 'application/pdf', page_count: 6 }),
    extractor: { extract: async (input) => { calls.push(input); return reply(input); } },
    now: () => new Date('2026-10-19T02:00:00.000Z'),
    ...extra,
  };
  return { ports, calls };
}

const valid = (r: unknown) => {
  const parsed = ExtractStageResultSchema.safeParse(r);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3), null, 1));
};

describe('runExtract', () => {
  it('S2-AC01: 1 file có CCCD + GCN → 2 evidence', async () => {
    const { ports } = setup();
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'id_card', instances: [[1, 2]] }, { key: 'land_use_certificate', instances: [[3, 6]] }] }]), ports);
    expect(r.data!.evidences.map((e) => e.doc_type_key)).toEqual(['id_card', 'land_use_certificate']);
    expect([r.status, r.status_code]).toEqual(['SUCCESS', 'COMPLETED']);
    valid(r);
  });

  it('S2-AC02: file 2 CCCD → 2 evidence instance 1 và 2', async () => {
    const { ports } = setup();
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'id_card', instances: [[1, 2], [3, 4]] }] }]), ports);
    expect(r.data!.evidences.map((e) => [e.instance_index, e.page_range])).toEqual([[1, [1, 2]], [2, [3, 4]]]);
    valid(r);
  });

  it('S2-AC10: evidence_id tất định theo (file, loại, bản thể), giống giữa 2 lần chạy', async () => {
    const input = classify([{ id: FILE_A, matches: [{ key: 'cic', instances: [[1, 1]] }] }, { id: FILE_B, matches: [{ key: 'cic', instances: [[1, 1]] }] }]);
    const r1 = await runExtract(input, setup().ports);
    const r2 = await runExtract(input, setup().ports);
    expect(r1.data!.evidences.map((e) => e.evidence_id)).toEqual(r2.data!.evidences.map((e) => e.evidence_id));
    expect(r1.data!.evidences[0].evidence_id).toBe(evidenceId(FILE_A, 'cic', 1));
    expect(r1.data!.evidences[0].evidence_id).not.toBe(r1.data!.evidences[1].evidence_id);
    expect(r1.data!.evidences[0].evidence_id).toMatch(/^ev-[0-9a-f]{12}$/);
  });

  it('S2-AC11: 1 evidence ERROR → PARTIAL_SUCCESS, không FAILED', async () => {
    const reply: Reply = (i) => (i.doc_type_key === 'cic' ? { form_found: false, data: null } : okReply(i));
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'cic', instances: [[1, 1]] }, { key: 'id_card', instances: [[2, 3]] }] }]), setup(reply).ports);
    expect([r.status, r.status_code]).toEqual(['PARTIAL_SUCCESS', 'EXTRACTION_ERRORS_PRESENT']);
    expect(r.data!.evidences[0]).toMatchObject({ status: 'ERROR', reason_code: 'FORM_NOT_FOUND', data: null, field_confidences: {} });
    expect(r.content_preview).toMatchObject({ evidence_count: 2, error_count: 1, success_count: 1 });
    valid(r);
  });

  it('mọi loan_application được gọi trước loại khác', async () => {
    const order: string[] = [];
    const reply: Reply = (i) => { order.push(i.doc_type_key); return okReply(i); };
    const { ports } = setup(reply);
    await runExtract(classify([
      { id: FILE_A, matches: [{ key: 'id_card', instances: [[1, 2]] }] },
      { id: FILE_B, matches: [{ key: 'cic', instances: [[1, 1]] }, { key: 'loan_application', instances: [[2, 6]] }] },
    ]), ports);
    expect(order[0]).toBe('loan_application');
    expect(order.slice(1).sort()).toEqual(['cic', 'id_card']);
  });

  it('match LIGHT đi qua bóc tách nhẹ, extraction_level đúng', async () => {
    const { ports, calls } = setup();
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'household_business_license', instances: [[1, 1]] }, { key: 'id_card', instances: [[2, 3]] }] }]), ports);
    expect(calls.map((c) => c.extraction_level)).toEqual(['LIGHT', 'FULL']);
    expect(r.data!.evidences.map((e) => e.extraction_level)).toEqual(['LIGHT', 'FULL']);
    expect(Object.keys(r.data!.evidences[0].data!).sort()).toEqual(['fields', 'legal_info', 'parties']);
    valid(r);
  });

  it('không có match nào → NOT_EVALUATED', async () => {
    const r = await runExtract({ files: [], repeated_doc_types: [] }, setup().ports);
    expect([r.status, r.status_code]).toEqual(['NOT_EVALUATED', 'NO_EXTRACTABLE_DOCUMENTS']);
    valid(r);
  });

  it('OCR down → UNAVAILABLE', async () => {
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'cic', instances: [[1, 1]] }] }]), setup(() => { throw new Error('503'); }).ports);
    expect([r.status, r.status_code, r.data]).toEqual(['UNAVAILABLE', 'INTEGRATION_SERVICE_DOWN', null]);
    valid(r);
  });

  it('field khác null luôn có source_pages; field null có confidence 0', async () => {
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'id_card', instances: [[2, 3]] }] }]), setup().ports);
    const e = r.data!.evidences[0];
    for (const [k, v] of Object.entries(e.data!)) {
      if (v === null) expect(e.field_confidences[k]).toBe(0);
      else expect(e.source_pages[k]?.length).toBeGreaterThan(0);
    }
    expect(e.source_pages.parties).toEqual([2]);
  });

  it('GCN: chủ hiện tại tính lại theo trang biến động', async () => {
    const reply: Reply = (i) => {
      const data = makeFullData('land_use_certificate');
      const own = (idx: number, source: string, date: string | null) => makeParty({
        party_index: idx, party_role: 'OWNER', ownership: { asset_index: 0, ownership_source: source, ownership_change_date: date, is_current_owner: true },
      });
      data.parties = [own(0, 'COVER_PAGE', null), own(1, 'CHANGE_RECORD', '2024-01-01')];
      return { form_found: true, data, field_confidences: { parties: 0.95 }, source_pages: { parties: [i.page_range[0]] } };
    };
    const r = await runExtract(classify([{ id: FILE_A, matches: [{ key: 'land_use_certificate', instances: [[1, 4]] }] }]), setup(reply).ports);
    const parties = r.data!.evidences[0].data!.parties as Array<{ ownership: { is_current_owner: boolean } }>;
    expect(parties.map((p) => p.ownership.is_current_owner)).toEqual([false, true]);
    valid(r);
  });

  it('tên file không tới extractor', async () => {
    const { ports, calls } = setup();
    const input = classify([{ id: FILE_A, matches: [{ key: 'cic', instances: [[1, 1]] }] }]);
    input.files[0].file_name = 'ho-so-zq9911.pdf';
    await runExtract(input, ports);
    expect(JSON.stringify({ ...calls[0], content: undefined })).not.toContain('zq9911');
  });
});
