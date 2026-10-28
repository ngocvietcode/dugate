// So sánh một party với một party đã gom của người (T-FS-02; spec s3_fellegi_sunter.md §3.2, FS-R03, FS-R04).
// Chỉ dùng hàm chuẩn hóa sẵn có; không viết luật tên thứ hai.
import { isOldNewPair } from '../../common/id-number';
import { nameLevel } from '../../common/name';
import { normIdNumber } from '../../common/normalize';
import type { DocumentParty } from '../../s2/common-schema';
import type { Person } from '../types';
import { ID_CONFIDENCE_MIN } from '../match-parties';
import type { FS_LEVELS, FsField } from './params';

export type FsLevel<F extends FsField = FsField> = (typeof FS_LEVELS)[F][number] | 'MISSING' | 'NOT_APPLICABLE';
export type FsLevels = { [F in FsField]: FsLevel<F> };

const idsOf = (p: DocumentParty) => [p.id_number, ...p.previous_id_numbers].map(normIdNumber).filter((n): n is string => n !== null);
const oneOff = (a: string, b: string) => a.length === b.length && a.length >= 9 && [...a].filter((c, i) => c !== b[i]).length === 1;
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleUpperCase('vi-VN');

function idLevel(party: DocumentParty, confidence: number, known: ReadonlySet<string>): FsLevel<'id_number'> {
  const ids = idsOf(party);
  if (ids.length === 0 || known.size === 0 || confidence < ID_CONFIDENCE_MIN) return 'MISSING';
  if (ids.some((n) => known.has(n))) return 'AGREE';
  if (ids.some((n) => [...known].some((k) => oneOff(n, k)))) return 'NEAR';
  if (ids.some((n) => [...known].some((k) => isOldNewPair(n, k)))) return 'OLD_NEW';
  return 'DISAGREE';
}

function dobLevel(a: string | null, b: string | null): FsLevel<'date_of_birth'> {
  if (!a || !b) return 'MISSING';
  if (a === b) return 'AGREE';
  const [ya, ma, da] = a.split('-'); const [yb, mb, db] = b.split('-');
  return ya === yb && ma === db && da === mb ? 'DAY_MONTH_SWAPPED' : 'DISAGREE';
}

function addressLevel(a: DocumentParty['permanent_address'], b: DocumentParty['permanent_address']): FsLevel<'permanent_address'> {
  const ta = norm(a?.full_text); const tb = norm(b?.full_text);
  const pa = norm(a?.province); const pb = norm(b?.province);
  if ((!ta || !tb) && (!pa || !pb)) return 'MISSING';
  if (ta && ta === tb) return 'AGREE';
  return pa && pa === pb ? 'SAME_PROVINCE' : 'DISAGREE';
}

/**
 * Số 12 chữ số: chữ số thứ 4 mã hóa giới tính + thế kỷ (0/1 nam/nữ 19xx, 2/3 nam/nữ 20xx), chữ số 5–6 là hai số cuối năm sinh.
 * So với ngày sinh / giới tính của party đã gom.
 */
function structureLevel(party: DocumentParty, other: DocumentParty): FsLevel<'id_structure'> {
  const id = normIdNumber(party.id_number);
  if (!id || id.length !== 12 || !/^[0-3]$/.test(id[3]) || (!other.date_of_birth && !other.gender)) return 'NOT_APPLICABLE';
  const code = Number(id[3]);
  const gender = code % 2 === 0 ? 'MALE' : 'FEMALE';
  const year = `${code < 2 ? '19' : '20'}${id.slice(4, 6)}`;
  const ok = (!other.gender || other.gender === gender) && (!other.date_of_birth || other.date_of_birth.slice(0, 4) === year);
  return ok ? 'CONSISTENT' : 'INCONSISTENT';
}

/** `party` (chứng từ đang xét, confidence `confidence`) so với `other` (một party đã gom vào `person`). Số so với cả `K(p)`. */
export function comparePair(party: DocumentParty, confidence: number, other: DocumentParty, person: Person): FsLevels {
  const id_number = idLevel(party, confidence, person.known_ids);
  const idDecided = id_number === 'AGREE' || id_number === 'NEAR'; // FS-R04: giới tính, năm sinh đã nằm trong số
  return {
    id_number,
    full_name: party.full_name?.trim() && other.full_name?.trim() ? nameLevel(party.full_name, other.full_name) : 'MISSING',
    date_of_birth: dobLevel(party.date_of_birth, other.date_of_birth),
    gender: idDecided || !party.gender || !other.gender ? 'MISSING' : party.gender === other.gender ? 'AGREE' : 'DISAGREE',
    permanent_address: addressLevel(party.permanent_address, other.permanent_address),
    id_structure: idDecided ? 'MISSING' : structureLevel(party, other),
  };
}
