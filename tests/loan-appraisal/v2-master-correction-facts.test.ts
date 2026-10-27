// Hiệu chỉnh master: dữ kiện gửi LLM mang đủ tín hiệu để chọn khi hai bản ngang số lượng (1 đối 1).
import { buildCorrectionFacts, MASTER_CORRECTION_PROMPT_TEMPLATE } from '@/lib/pipelines/workflows/loan-appraisal/master-correction';
import type { CorrectionProposal } from '@/lib/loan-dossier/master/correct';

const proposal = (over: Partial<CorrectionProposal['options'][number]>[]): CorrectionProposal => ({
  proposal_id: 'mc-0123456789ab', scope: 'person', scope_id: 'person-1', scope_label: 'Khách hàng vay · NGUYỄN VĂN AN',
  field_index: 0, path: 'id_number', label: 'Số CCCD', kind: 'id',
  options: over.map((o, i) => ({
    option_id: `o${i + 1}`, value: '', key: '', evidence_ids: [`ev-00000000000${i + 1}#parties[0].id_number`], where: ['x'],
    confidence: 0.9, canonical: false, format_ok: true, ...o,
  })),
});

describe('buildCorrectionFacts', () => {
  it('mỗi lựa chọn mang chứng từ gốc và hợp lệ định dạng, không lộ khóa so nội bộ', () => {
    const [f] = buildCorrectionFacts([proposal([
      { value: '001090000001', canonical: true, format_ok: true },
      { value: '00109000001', canonical: false, format_ok: false },
    ])]) as Array<{ lua_chon: Array<Record<string, unknown>> }>;
    expect(f.lua_chon.map((o) => [o.option_id, o.la_chung_tu_chuan, o.dung_dinh_dang])).toEqual([['o1', true, true], ['o2', false, false]]);
    expect(JSON.stringify(f)).not.toContain('"key"');
  });

  it('prompt hướng dẫn thứ tự căn cứ và chỉ giữ xung đột khi thật sự ngang nhau', () => {
    expect(MASTER_CORRECTION_PROMPT_TEMPLATE).toContain('la_chung_tu_chuan');
    expect(MASTER_CORRECTION_PROMPT_TEMPLATE).toContain('dung_dinh_dang');
    expect(MASTER_CORRECTION_PROMPT_TEMPLATE).toContain('nhìn chung là chính xác');
    for (const name of ['proposals', 'output_schema']) expect(MASTER_CORRECTION_PROMPT_TEMPLATE).toContain(`{{${name}}}`);
  });
});
