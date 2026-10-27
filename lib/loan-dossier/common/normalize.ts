// Chuẩn hóa giá trị dùng chung (T-S2-03; S2-R10, S2-R17). Hàm thuần, không log.
// Quy ước: không đọc được → null, không đoán.

const pad2 = (n: number) => String(n).padStart(2, '0');

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Ngày → ISO. Nhận `dd/MM/yyyy`, `d/M/yyyy`, `dd-MM-yyyy`, `dd.MM.yyyy`, có/không kèm giờ,
 * `ngày 26 tháng 11 năm 2023`, ISO sẵn (`YYYY-MM-DD`). Chỉ tháng/năm → `YYYY-MM`; chỉ năm → `YYYY`
 * (S2-R07: không tự thêm ngày). Ngày không tồn tại (31/02) → null.
 */
export function normDate(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).normalize('NFC').trim().toLowerCase();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t\s].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;

  m = s.match(/(?:ngày\s*)?(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/);
  if (!m) m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[\s,].*)?$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  m = s.match(/^(?:tháng\s*)?(\d{1,2})\s*(?:[/.-]|năm)\s*(\d{4})$/);
  if (m) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    return mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100 ? `${y}-${pad2(mo)}` : null;
  }
  m = s.match(/^(?:năm\s*)?(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    return y >= 1900 && y <= 2100 ? m[1] : null;
  }
  return null;
}

/**
 * Tiền → số nguyên VND. Nhận "120.000.000 đ", "120,000,000", "2 489 000 000 VNĐ", "120000000".
 * Dấu `.`/`,`/khoảng trắng đều coi là phân nhóm nghìn — chỉ hợp lệ khi mọi nhóm sau nhóm đầu đủ 3 chữ số.
 * Âm, thập phân, chữ → null.
 */
export function normMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isSafeInteger(input) && input >= 0 ? input : null;
  let s = String(input).normalize('NFC').trim().toLowerCase();
  s = s.replace(/(vnđ|vnd|đồng|đ)\.?$/u, '').trim();
  if (!s || s.startsWith('-')) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  const groups = s.split(/[.,\s]+/);
  if (groups.length < 2 || !/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
  const n = Number(groups.join(''));
  return Number.isSafeInteger(n) ? n : null;
}

/** Số định danh: chỉ giữ chữ số, giữ số 0 đầu. Không có chữ số → null. */
export function normIdNumber(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** Tên: NFC, HOA, gộp khoảng trắng, **giữ dấu** (S2-R17). Rỗng → null. */
export function normName(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
  return s || null;
}

/** Khóa so khớp mã (biển số, số khung, số GCN…): HOA, bỏ khoảng trắng, `.`, `-`. Rỗng → null. */
export function normKey(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).normalize('NFC').toLocaleUpperCase('vi-VN').replace(/[\s.-]+/g, '');
  return s || null;
}
