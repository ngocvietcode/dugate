// T-COM-02 — so khớp số định danh.
import { idKind, isOldNewPair, sameId } from '@/lib/loan-dossier/common/id-number';

describe('id-number', () => {
  it('chuẩn hóa: khoảng trắng bỏ, số 0 đầu giữ', () => {
    expect(sameId('0123 456 789', '0123456789')).toBe(true);
    expect(sameId('012345678', '12345678')).toBe(false);
  });
  it('thiếu một bên → không cùng số', () => {
    expect(sameId(null, '000000000000')).toBe(false);
    expect(sameId('', '')).toBe(false);
  });
  it('isOldNewPair: 9 số vs 12 số', () => {
    expect(isOldNewPair('012345678', '012345678901')).toBe(true);
    expect(isOldNewPair('012345678901', '012345678')).toBe(true);
    expect(isOldNewPair('012345678901', '000000000000')).toBe(false);
  });
  it('idKind 3 nhánh', () => {
    expect(idKind('012345678')).toBe('ID9');
    expect(idKind('012 345 678 901')).toBe('ID12');
    expect(idKind('B1234567')).toBe('OTHER');
    expect(idKind(null)).toBe('OTHER');
  });
});
