// T-S2-04 — chủ sở hữu hiện tại trong 1 chứng từ (S2-R13).
import { markCurrentOwners } from '@/lib/loan-dossier/s2/current-owner';

import { makeParty } from './fixtures/build';

const owner = (i: number, source: 'COVER_PAGE' | 'CHANGE_RECORD', date: string | null = null, assetIndex = 0) => makeParty({
  party_index: i, party_role: 'OWNER',
  ownership: { asset_index: assetIndex, ownership_source: source, ownership_change_date: date, is_current_owner: false },
});
const current = (r: ReturnType<typeof markCurrentOwners>) => r.parties.map((p) => p.ownership?.is_current_owner ?? null);

describe('markCurrentOwners', () => {
  it('chỉ trang bìa → mọi party true', () => {
    const r = markCurrentOwners([owner(0, 'COVER_PAGE'), owner(1, 'COVER_PAGE')]);
    expect(current(r)).toEqual([true, true]);
    expect(r.confidenceCap).toBeNull();
  });

  it('S2-AC06: bìa + 2 biến động khác ngày → duy nhất bên ngày muộn là true', () => {
    const r = markCurrentOwners([owner(0, 'COVER_PAGE'), owner(1, 'CHANGE_RECORD', '2020-05-01'), owner(2, 'CHANGE_RECORD', '2024-03-10')]);
    expect(current(r)).toEqual([false, false, true]);
  });

  it('2 biến động cùng ngày muộn nhất → cả hai true', () => {
    const r = markCurrentOwners([owner(0, 'COVER_PAGE'), owner(1, 'CHANGE_RECORD', '2024-03-10'), owner(2, 'CHANGE_RECORD', '2024-03-10')]);
    expect(current(r)).toEqual([false, true, true]);
  });

  it('biến động ngày null + biến động có ngày → xét bên có ngày, confidenceCap = 0.5', () => {
    const r = markCurrentOwners([owner(0, 'COVER_PAGE'), owner(1, 'CHANGE_RECORD', null), owner(2, 'CHANGE_RECORD', '2023-01-01')]);
    expect(current(r)).toEqual([false, false, true]);
    expect(r.confidenceCap).toBe(0.5);
  });

  it('party không có ownership không bị chạm; đầu vào không bị sửa', () => {
    const input = [makeParty({ party_index: 0, party_role: 'OWNER' }), owner(1, 'COVER_PAGE')];
    const r = markCurrentOwners(input);
    expect(r.parties[0]).toEqual(input[0]);
    expect(input[1].ownership!.is_current_owner).toBe(false);
    expect(r.parties[1].ownership!.is_current_owner).toBe(true);
  });

  it('tính riêng theo từng tài sản', () => {
    const r = markCurrentOwners([owner(0, 'COVER_PAGE', null, 0), owner(1, 'COVER_PAGE', null, 1), owner(2, 'CHANGE_RECORD', '2024-01-01', 1)]);
    expect(current(r)).toEqual([true, false, true]);
  });
});
