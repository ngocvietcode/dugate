// T-COM-01 — chuẩn hóa và so khớp tên.
import { isNameMatch, nameLevel, normalizeName } from '@/lib/loan-dossier/common/name';

describe('normalizeName', () => {
  it('bỏ danh xưng đầu: ÔNG, Mr', () => {
    expect(normalizeName('Ông Nguyễn Văn A')).toBe('NGUYỄN VĂN A');
    expect(normalizeName('Mr. Tran Van B')).toBe('TRAN VAN B');
  });
  it('không bỏ "ANH" ở giữa / cuối tên', () => expect(normalizeName('Nguyễn Thị Anh')).toBe('NGUYỄN THỊ ANH'));
  it('ký tự lạ → khoảng trắng, gộp khoảng trắng', () => expect(normalizeName(' nguyễn-văn,  a ')).toBe('NGUYỄN VĂN A'));
});

describe('nameLevel', () => {
  it('EXACT', () => expect(nameLevel('nguyễn văn a', 'NGUYỄN  VĂN A')).toBe('EXACT'));
  it('A B C vs C A B → REORDERED', () => expect(nameLevel('A B C', 'C A B')).toBe('REORDERED'));
  it('HẰNG vs HANG → SPELLING_DIFFERENCE, không khớp', () => {
    const level = nameLevel('NGUYỄN THỊ HẰNG', 'NGUYỄN THỊ HANG');
    expect(level).toBe('SPELLING_DIFFERENCE');
    expect(isNameMatch(level)).toBe(false);
  });
  it('Đ vs D được coi là bỏ dấu', () => expect(nameLevel('ĐỖ VĂN ĐỨC', 'DO VAN DUC')).toBe('SPELLING_DIFFERENCE'));
  it('cùng số từ, Levenshtein ≤ 2 → SPELLING_DIFFERENCE', () =>
    expect(nameLevel('NGUYEN VAN AN', 'NGUYEN VAN AM')).toBe('SPELLING_DIFFERENCE'));
  it('khác 3 ký tự, cùng số từ → NO_MATCH', () => expect(nameLevel('NGUYEN VAN AN', 'NGUYEN VAN XYZ')).toBe('NO_MATCH'));
  it('chuỗi rỗng / null → NO_MATCH', () => {
    expect(nameLevel('', 'A')).toBe('NO_MATCH');
    expect(nameLevel(null, 'A')).toBe('NO_MATCH');
  });
  it('EXACT, REORDERED là khớp', () => {
    expect(isNameMatch('EXACT')).toBe(true);
    expect(isNameMatch('REORDERED')).toBe(true);
    expect(isNameMatch('NO_MATCH')).toBe(false);
  });
});
