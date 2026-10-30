// D-118 — một ngưỡng "lệch một lỗi" cho mã/số: thêm / bớt / thay 1 ký tự hoặc đảo 2 ký tự liền nhau, dài ≥ 6.
import { nearIdentifier, nearMatch } from '@/lib/loan-dossier/s5/compare-exact';

describe('nearIdentifier', () => {
  it('đảo 2 ký tự liền nhau, thêm / bớt / thay 1 ký tự → gần khớp; 2 lỗi hoặc mã ngắn → không', () => {
    expect(nearIdentifier('AA08798136', 'AA07898136')).toBe(true);
    expect(nearIdentifier('AA08798136', 'AA0798136')).toBe(true);
    expect(nearIdentifier('AA08798136', 'AA08798137')).toBe(true);
    expect(nearIdentifier('AA08798136', 'AA07898137')).toBe(false);
    expect(nearIdentifier('AB123', 'AB132')).toBe(false);
    expect(nearIdentifier('AA08798136', 'AA08798136')).toBe(false);
  });
});

describe('nearMatch (S5 "Gần khớp", D-41)', () => {
  it('2 nguồn ghi số đúng, 1 nguồn đảo 2 ký tự → Gần khớp, nguồn lệch là outlier', () => {
    expect(nearMatch(['AA08798136', 'AA08798136', 'AA07898136'])).toEqual({ majority: 'AA08798136', outlier: 2, agreeing: 2 });
  });
  it('chỉ 1 nguồn mỗi bên → không có đa số, không phải Gần khớp', () => {
    expect(nearMatch(['AA08798136', 'AA07898136'])).toBeNull();
  });
});
