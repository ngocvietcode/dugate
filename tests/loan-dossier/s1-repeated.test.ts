// T-S1-05 — tín hiệu nghi trùng mức loại (S1-R16).
import { repeatedDocTypes } from '@/lib/loan-dossier/s1/repeated';

const f = (file_id: string, ...keys: string[]) => ({ file_id, matches: keys.map((doc_type_key) => ({ doc_type_key })) });

describe('repeatedDocTypes', () => {
  it('S1-AC10: 2 file cùng GCN → 1 phần tử, đủ file_ids', () => {
    const out = repeatedDocTypes([f('file-aaaaaaaaaaa1', 'land_use_certificate', 'id_card'), f('file-aaaaaaaaaaa2', 'land_use_certificate')]);
    expect(out).toEqual([{
      doc_type_key: 'land_use_certificate', file_ids: ['file-aaaaaaaaaaa1', 'file-aaaaaaaaaaa2'], status: 'DUPLICATE_CANDIDATE', requires_review: true,
    }]);
  });

  it('nhiều instance trong 1 file → rỗng', () => {
    expect(repeatedDocTypes([f('file-aaaaaaaaaaa1', 'id_card', 'id_card')])).toEqual([]);
  });

  it('luôn DUPLICATE_CANDIDATE + requires_review', () => {
    const out = repeatedDocTypes([f('file-1', 'cic'), f('file-2', 'cic'), f('file-3', 'cic', 'vneid'), f('file-4', 'vneid')]);
    expect(out).toHaveLength(2);
    for (const r of out) expect([r.status, r.requires_review]).toEqual(['DUPLICATE_CANDIDATE', true]);
    expect(out[0].file_ids).toEqual(['file-1', 'file-2', 'file-3']);
  });
});
