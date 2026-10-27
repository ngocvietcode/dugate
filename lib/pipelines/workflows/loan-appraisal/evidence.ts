import type { EvidenceRecord, EvidenceRegistry } from './types';

function primitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizePrimitive(value: string | number | boolean): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || ['N/A', 'NOT_FOUND', '-'].includes(trimmed.toUpperCase())) return null;
  return trimmed;
}

/**
 * Lấy confidence trích xuất cho một leaf dựa trên khóa field CẤP CAO NHẤT trong
 * field path. Model trả confidence theo field cấp cao (VD "personal_info"),
 * nên mọi leaf con của nó dùng chung giá trị đó.
 */
export function resolveFieldConfidence(path: string, fieldConfidences: Record<string, number>): number | null {
  if (!path) return null;
  // Ưu tiên confidence của đúng đường dẫn field; không có thì lùi dần về nhóm cha
  // ("personal_info.full_name" → "personal_info"; "owners[0].id_number" →
  // "owners[0]" → "owners"). Tương thích map cũ chỉ có khóa cấp cao nhất.
  let candidate = path;
  for (;;) {
    const value = fieldConfidences[candidate];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parent = candidate.replace(/(\.[^.[\]]+|\[\d+\])$/, '');
    if (parent === candidate || !parent) return null;
    candidate = parent;
  }
}

function flattenLeaves(value: unknown, path = '', out: Array<{ path: string; value: string | number | boolean }> = []) {
  if (primitive(value)) {
    out.push({ path: path || 'value', value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenLeaves(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenLeaves(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}


/** Nhãn hay đứng trước số hiệu trên chứng từ, không phải phần của số. */
const DOC_ID_LABELS = /\b(GIAY CHUNG NHAN|SO VAO SO|VAO SO|SO GCN|GCN|SO MAY|SO KHUNG|SO SERI|SERI|SO|NO|NUMBER)\b/g;

/**
 * Chuẩn hóa SỐ HIỆU giấy tờ/tài sản (số GCN, số máy, số khung, thửa đất, biển
 * số) để so khớp và gom nhóm: bỏ dấu, hoa hết, bỏ nhãn dẫn ("Số:", "GCN"), bỏ
 * mọi ký tự phân cách. Nhờ vậy "AA 08798136", "Số: AA-08798136" và "aa08798136"
 * cùng cho một khóa.
 */
export function normalizeDocumentId(value: unknown): string {
  if (value === null || value === undefined) return '';
  const upper = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return upper.replace(DOC_ID_LABELS, ' ').replace(/[^A-Z0-9]/g, '');
}

/** Đơn vị tiền tiếng Việt → hệ số. Dùng lookaround Unicode vì \b chỉ hiểu ASCII (không bắt được "tỷ"). */
const MONEY_UNIT_SOURCE = '(tỷ|ty|triệu|trieu|tr|nghìn|nghin|ngàn|ngan)(?!\\p{L})';
const MONEY_UNIT_MULTIPLIER: Record<string, number> = {
  'tỷ': 1_000_000_000, ty: 1_000_000_000,
  'triệu': 1_000_000, trieu: 1_000_000, tr: 1_000_000,
  'nghìn': 1_000, nghin: 1_000, 'ngàn': 1_000, ngan: 1_000,
};
const MONEY_CURRENCY = /(?<!\p{L})(vnđ|vnd|đồng|đ)(?!\p{L})|₫/gu;

/** Số không kèm đơn vị: dấu phân cách cuối có đúng 3 chữ số = ngăn nghìn; có cả '.' và ',' thì dấu sau cùng là thập phân. */
function parsePlainNumber(text: string): number {
  const dot = text.lastIndexOf('.');
  const comma = text.lastIndexOf(',');
  let normalized = text;
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = text.split(thousands).join('').replace(decimal, '.');
  } else if (dot >= 0 || comma >= 0) {
    const separator = dot >= 0 ? '.' : ',';
    const parts = text.split(separator);
    normalized = parts[parts.length - 1].length === 3 ? parts.join('') : `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
  }
  return Number(normalized);
}

/** Số đi kèm đơn vị: một dấu ',' hoặc '.' đơn lẻ luôn là thập phân ("1,250 tỷ" = 1,25 tỷ). */
function parseUnitNumber(text: string): number {
  if (/^\d+[.,]\d+$/.test(text)) return Number(text.replace(',', '.'));
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ''));
  return Number(text);
}

/**
 * Parse chuỗi tiền do LLM bóc tách (giữ nguyên định dạng chứng từ). Trả null khi
 * không có chữ số, có mã tiền tệ khác VND (USD, EUR, $...) hoặc không hiểu được
 * — không đoán. Hỗ trợ số âm "-5.000.000" và dạng kế toán "(1.000.000)".
 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Model có thể trả NFD; đưa về NFC để nhận diện đơn vị có dấu.
  const text = value.normalize('NFC').toLowerCase().replace(MONEY_CURRENCY, ' ').trim();
  if (!/\d/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);

  const unitPattern = new RegExp(`(\\d[\\d.,]*)\\s*${MONEY_UNIT_SOURCE}`, 'gu');
  const segments = [...text.matchAll(unitPattern)];
  let total: number;
  if (segments.length > 0) {
    // Mọi chữ số phải thuộc một đoạn "số + đơn vị"; còn lại chỉ được là ký hiệu dấu/khoảng trắng.
    const rest = text.replace(unitPattern, '');
    if (/[\p{L}\p{Sc}\d]/u.test(rest)) return null;
    total = segments.reduce((sum, m) => sum + parseUnitNumber(m[1]) * MONEY_UNIT_MULTIPLIER[m[2]], 0);
    total = Math.round(total);
  } else {
    if (/[\p{L}\p{Sc}]/u.test(text)) return null;
    const digits = text.replace(/[\s()+-]/g, '');
    if (!/^\d[\d.,]*$/.test(digits)) return null;
    total = parsePlainNumber(digits);
  }
  if (!Number.isFinite(total)) return null;
  return negative ? -total : total;
}
/**
 * Tìm evidence ĐÃ CHẤP NHẬN đầu tiên khớp field path + loại chứng từ và parse
 * được bằng `parse`. Dùng chung cho tiền, kỳ hạn, lãi suất, cờ boolean.
 */
export function findParsedEvidence<T>(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes: string[] | undefined,
  parse: (value: unknown) => T | null,
): { value: T; evidenceIds: string[] } | null {
  const matches = registry.records.filter((record) => {
    if (record.review_status !== 'ACCEPTED' || record.evidence_kind === 'CHECKLIST_STATUS') return false;
    if (docTypes && !docTypes.includes(record.doc_type_key)) return false;
    return pathPatterns.some((pattern) => pattern.test(record.field_path));
  });
  for (const match of matches) {
    const value = parse(match.normalized_value);
    if (value !== null) return { value, evidenceIds: [match.evidence_id] };
  }
  return null;
}

export function findMoneyEvidence(
  registry: EvidenceRegistry,
  pathPatterns: RegExp[],
  docTypes?: string[],
): { value: number; evidenceIds: string[] } | null {
  return findParsedEvidence(registry, pathPatterns, docTypes, (raw) => {
    const value = parseMoney(raw);
    return value !== null && value >= 0 ? value : null;
  });
}
