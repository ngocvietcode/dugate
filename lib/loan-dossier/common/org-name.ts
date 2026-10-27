// So khớp tên pháp nhân (doanh nghiệp). Hàm thuần.
// Khác tên người: bỏ loại hình / danh xưng ("CÔNG TY", "TNHH", "CỔ PHẦN"…) rồi so phần tên riêng; KHÔNG chấp nhận đảo từ hay lệch ≤ 2 ký tự
// (tên công ty đảo từ là công ty khác). Hai loại hình khác nhau (TNHH ≠ CỔ PHẦN) thì không khớp dù cùng tên riêng.
import { normalizeName, stripDiacritics, type NameLevel } from './name';

export type LegalForm = 'TNHH' | 'CP' | 'DNTN' | 'HTX';

/** Cụm loại hình, dài trước ngắn (đã qua `normalizeName`: HOA, không dấu câu). Trả về loại hình chuẩn hóa. */
const FORM_PHRASES: Array<[string[], LegalForm | null]> = [
  [['TRÁCH', 'NHIỆM', 'HỮU', 'HẠN', 'MỘT', 'THÀNH', 'VIÊN'], 'TNHH'],
  [['TRÁCH', 'NHIỆM', 'HỮU', 'HẠN', 'HAI', 'THÀNH', 'VIÊN', 'TRỞ', 'LÊN'], 'TNHH'],
  [['TRÁCH', 'NHIỆM', 'HỮU', 'HẠN'], 'TNHH'],
  [['DOANH', 'NGHIỆP', 'TƯ', 'NHÂN'], 'DNTN'],
  [['HỢP', 'TÁC', 'XÃ'], 'HTX'],
  [['CỔ', 'PHẦN'], 'CP'],
  [['TNHH', 'MTV'], 'TNHH'],
  [['TNHH'], 'TNHH'],
  [['MTV'], null],
  [['DNTN'], 'DNTN'],
  [['HTX'], 'HTX'],
  [['CP'], 'CP'],
  [['CÔNG', 'TY'], null],
  [['CTY'], null],
  [['TY'], null],
];

export interface OrgName {
  /** Phần tên riêng sau khi bỏ loại hình / danh xưng; '' khi không còn gì. */
  core: string;
  form: LegalForm | null;
}

/** Bóc loại hình khỏi ĐẦU tên. Cụm loại hình so theo dạng bỏ dấu (tên OCR có thể mất dấu); phần tên riêng giữ nguyên dấu. */
export function parseOrgName(input: string | null | undefined): OrgName {
  const words = normalizeName(input).split(' ').filter(Boolean);
  const plain = words.map(stripDiacritics);
  let form: LegalForm | null = null;
  let progressed = true;
  while (progressed && words.length > 0) {
    progressed = false;
    for (const [phrase, kind] of FORM_PHRASES) {
      if (phrase.length <= words.length && phrase.every((w, i) => plain[i] === stripDiacritics(w))) {
        words.splice(0, phrase.length);
        plain.splice(0, phrase.length);
        if (kind) form = kind;
        progressed = true;
        break;
      }
    }
  }
  return { core: words.join(' '), form };
}

/**
 * `EXACT` khi phần tên riêng trùng và loại hình không mâu thuẫn; `SPELLING_DIFFERENCE` khi chỉ khác dấu tiếng Việt; còn lại `NO_MATCH`.
 * Tên chỉ có loại hình ("CÔNG TY") không đủ để kết luận → `NO_MATCH`.
 */
export function orgNameLevel(a: string | null | undefined, b: string | null | undefined): NameLevel {
  const x = parseOrgName(a);
  const y = parseOrgName(b);
  if (!x.core || !y.core) return 'NO_MATCH';
  if (x.form && y.form && x.form !== y.form) return 'NO_MATCH';
  if (x.core === y.core) return 'EXACT';
  if (stripDiacritics(x.core) === stripDiacritics(y.core)) return 'SPELLING_DIFFERENCE';
  return 'NO_MATCH';
}
