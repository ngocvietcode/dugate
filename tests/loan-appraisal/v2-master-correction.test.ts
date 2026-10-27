// T-MD-11 — LLM hiệu chỉnh master_dossier: prompt, checkpoint, nối workflow (MD-R16, MD-R18, MD-R20; MD-AC14, AC16, AC17).
const enqueueMock = jest.fn();
jest.mock('@/lib/pipelines/workflow-engine', () => {
  const actual = jest.requireActual('@/lib/pipelines/workflow-engine');
  return { ...actual, enqueueSubStep: (...args: unknown[]) => enqueueMock(...args) };
});

import {
  buildCorrectionFacts, MASTER_CORRECTION_PROMPT_TEMPLATE, resolveMasterCorrection, runMasterCorrection, type AskMasterCorrection,
} from '@/lib/pipelines/workflows/loan-appraisal/master-correction';
import { proposeMasterCorrections } from '@/lib/loan-dossier/master/correct';
import { MasterDossierSchema } from '@/lib/loan-dossier/contracts/master-dossier';
import { WorkflowCancelledError } from '@/lib/pipelines/workflow-engine';

import { classifyOf, ev, ID_A12, loanApp } from '../loan-dossier/fixtures/dossier';
import { runDossier } from '../loan-dossier/fixtures/master';

const BAD_ID = '001090000077'; // cách ID_A12 2 ký tự
const borrower = { party_role: 'BORROWER', full_name: 'NGUYỄN VĂN AN', id_number: ID_A12 };
const holder = (id: string) => ({ party_role: 'HOLDER', full_name: 'NGUYỄN VĂN AN', id_number: id });
const evidences = () => [loanApp([borrower]), ev('id_card', { parties: [holder(ID_A12)] }), ev('cic', { parties: [holder(BAD_ID)] })];



beforeEach(() => { jest.clearAllMocks(); enqueueMock.mockResolvedValue({ content: '{}', operation: { id: 'sub-1' } }); });

/**
 * Phần nối workflow (đúng một lời gọi LLM, cache khi resume, model/prompt theo Profile) đã không còn: giai đoạn 2 tạm tắt master data và hiệu chỉnh master,
 * workflow không gọi chúng nữa. Logic thuần bên dưới vẫn còn nguyên và vẫn được kiểm tra, để bật lại được mà không viết lại.
 * Test hành vi workflow KHÔNG gọi LLM hiệu chỉnh master nằm ở v2-stage-consolidate.test.ts.
 */
describe('runMasterCorrection / resolveMasterCorrection', () => {
  const build = async () => {
    const r = await runDossier(evidences());
    return { ...r, proposals: proposeMasterCorrections(r.master, r.evidences) };
  };
  const decisionsFor = (p: { proposal_id: string }, extra: Record<string, unknown>) => ({ decisions: [{ proposal_id: p.proposal_id, action: 'SELECT', reason: 'x', ...extra }] });

  it('prompt có dữ kiện không chứa khóa so nội bộ và không có chỗ để trả giá trị', async () => {
    const { proposals } = await build();
    expect(proposals.length).toBeGreaterThan(0);
    const facts = JSON.stringify(buildCorrectionFacts(proposals));
    expect(facts).not.toContain('"key"');
    expect(facts).toContain('option_id');
    expect(MASTER_CORRECTION_PROMPT_TEMPLATE).toContain('KHÔNG tự tạo');
  });

  it('MD-AC16: option_id ngoài danh sách, mã lạ, hoặc giá trị riêng → bỏ; master giữ nguyên', async () => {
    const { master, evidences: evs, proposals } = await build();
    const p = proposals[0];
    for (const reply of [decisionsFor(p, { option_id: 'o9' }), decisionsFor({ proposal_id: 'mc-000000000000' }, { option_id: 'o1' }), decisionsFor(p, { option_id: null, value: ID_A12 })]) {
      const ask: AskMasterCorrection = async () => reply;
      const out = await resolveMasterCorrection({ master, evidences: evs, enabled: true, cached: undefined, ask, overrides: {} });
      expect(out.master).toBe(master);
    }
  });

  it('phản hồi không phải JSON hợp lệ → cảnh báo, không hiệu chỉnh', async () => {
    const { master, evidences: evs } = await build();
    const out = await resolveMasterCorrection({ master, evidences: evs, enabled: true, cached: undefined, ask: async () => 'không phải json', overrides: {} });
    expect(out.master).toBe(master);
    expect(out.warnings.join(' ')).toContain('không đúng định dạng');
    expect(out.fresh).not.toBeNull();
  });

  it('một quyết định hỏng không làm mất các quyết định tốt khác', async () => {
    const { proposals } = await build();
    const p = proposals[0];
    const cache = await runMasterCorrection(proposals, async () => ({ decisions: [42, { action: 'SELECT' }, { proposal_id: p.proposal_id, action: 'SELECT', option_id: p.options[0].option_id, reason: 'ok' }] }), {});
    expect(cache.decisions).toHaveLength(1);
    expect(cache.warnings.join(' ')).toContain('2 quyết định');
  });

  it('cache chỉ dùng khi tập mã đề xuất giống hệt; khác → gọi lại', async () => {
    const { master, evidences: evs, proposals } = await build();
    const ask = jest.fn(async () => ({ decisions: [] }));
    const good = { proposal_ids: proposals.map((p) => p.proposal_id), decisions: [], warnings: [], prompt_overridden: false };
    await resolveMasterCorrection({ master, evidences: evs, enabled: true, cached: good, ask, overrides: {} });
    expect(ask).not.toHaveBeenCalled();
    await resolveMasterCorrection({ master, evidences: evs, enabled: true, cached: { ...good, proposal_ids: ['mc-aaaaaaaaaaaa'] }, ask, overrides: {} });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('lỗi huỷ operation được ném lại, không bị nuốt', async () => {
    const { master, evidences: evs } = await build();
    const ask: AskMasterCorrection = async () => { throw new WorkflowCancelledError('x'); };
    await expect(resolveMasterCorrection({
      master, evidences: evs, enabled: true, cached: undefined, ask, overrides: {}, isPassThroughError: (e) => e instanceof WorkflowCancelledError,
    })).rejects.toBeInstanceOf(WorkflowCancelledError);
  });

  it('master = null → không làm gì', async () => {
    const ask = jest.fn();
    const out = await resolveMasterCorrection({ master: null, evidences: [], enabled: true, cached: undefined, ask, overrides: {} });
    expect(out).toMatchObject({ master: null, fresh: null, proposals: 0 });
    expect(ask).not.toHaveBeenCalled();
  });
});
