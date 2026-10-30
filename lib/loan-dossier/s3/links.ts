// Liên kết chủ thể do người thẩm định khai (COR-R08): SAME_SUBJECT = must-link, DIFFERENT_SUBJECT = cannot-link, cho người và tài sản.
// Hàm thuần. Ở đây chỉ kiểm hợp lệ, bỏ trùng và phát hiện mâu thuẫn giữa các liên kết; việc áp nằm trong matchParties / groupAssets.
import type { SubjectLink } from '../corrections/schema';
import type { AssetDescriptor, DocumentParty } from '../s2/common-schema';
import { splitJointOwner } from './split-names';
import type { Evidence } from './types';

export type LinkSkipCode = 'LINK_ORPHAN' | 'LINK_UNSUPPORTED' | 'LINK_CYCLE' | 'LINK_CONTRADICTS_ID' | 'LINK_CONFLICT' | 'DUPLICATE_TARGET';

export interface ResolvedLink {
  correction_id: string;
  /** `{evidence_id}#{index}` */
  a: string;
  b: string;
}

export interface SubjectLinks {
  same: ResolvedLink[];
  different: ResolvedLink[];
}

export interface ResolvedLinks {
  person: SubjectLinks;
  asset: SubjectLinks;
  skipped: Array<{ correction_id: string; kind: SubjectLink['kind']; code: LinkSkipCode }>;
}

/** Kết quả áp của từng liên kết đã qua `resolveLinks`; mã có mặt = bị bỏ khi áp (VD cùng số định danh). */
export type LinkOutcome = Map<string, LinkSkipCode>;

export const occurrenceKey = (evidenceId: string, index: number) => `${evidenceId}#${index}`;

export const EMPTY_LINKS: SubjectLinks = { same: [], different: [] };

export function resolveLinks(links: ReadonlyArray<SubjectLink>, evidences: ReadonlyArray<Evidence>, anchorId: string | null): ResolvedLinks {
  const byId = new Map(evidences.filter((e) => e.status === 'SUCCESS' && e.data).map((e) => [e.evidence_id, e]));
  const skipped: ResolvedLinks['skipped'] = [];
  const skip = (l: SubjectLink, code: LinkSkipCode) => skipped.push({ correction_id: l.correction_id, kind: l.kind, code });

  const exists = (kind: SubjectLink['subject_kind'], o: SubjectLink['a']): 'OK' | 'ORPHAN' | 'SPLIT' => {
    const e = byId.get(o.evidence_id);
    if (!e) return 'ORPHAN';
    if (kind === 'asset') return ((e.data!.assets as AssetDescriptor[] | undefined) ?? []).some((d) => d.asset_index === o.index) ? 'OK' : 'ORPHAN';
    const party = ((e.data!.parties as DocumentParty[] | undefined) ?? []).find((p) => p.party_index === o.index);
    if (!party) return 'ORPHAN';
    // Chủ sở hữu ghép (S3-R04) tách thành nhiều người: (evidence, party_index) không chỉ đúng một người.
    return splitJointOwner(party).length > 1 ? 'SPLIT' : 'OK';
  };

  // Cùng cặp (không kể thứ tự) và cùng loại chủ thể: bản corrected_at mới nhất thắng (hòa → bản đứng sau).
  const pairKey = (l: SubjectLink) => [l.subject_kind, ...[occurrenceKey(l.a.evidence_id, l.a.index), occurrenceKey(l.b.evidence_id, l.b.index)].sort()].join('|');
  const winner = new Map<string, number>();
  links.forEach((l, i) => {
    const prev = winner.get(pairKey(l));
    if (prev === undefined || Date.parse(l.corrected_at) >= Date.parse(links[prev].corrected_at)) winner.set(pairKey(l), i);
  });

  const valid: SubjectLink[] = [];
  links.forEach((l, i) => {
    if (winner.get(pairKey(l)) !== i) return skip(l, 'DUPLICATE_TARGET');
    const ea = exists(l.subject_kind, l.a);
    const eb = exists(l.subject_kind, l.b);
    if (ea === 'ORPHAN' || eb === 'ORPHAN') return skip(l, 'LINK_ORPHAN');
    if (ea === 'SPLIT' || eb === 'SPLIT') return skip(l, 'LINK_UNSUPPORTED');
    // Hai party của chính đơn vay đã thành người theo vai trò (S3-R02…R05); gộp / tách người của anchor nằm ngoài v1.
    if (l.subject_kind === 'person' && l.a.evidence_id === anchorId && l.b.evidence_id === anchorId) return skip(l, 'LINK_UNSUPPORTED');
    valid.push(l);
  });

  // Đóng bắc cầu SAME theo từng loại chủ thể; DIFFERENT nằm trong cùng thành phần → bỏ mọi liên kết chạm thành phần đó.
  const out: ResolvedLinks = { person: { same: [], different: [] }, asset: { same: [], different: [] }, skipped };
  for (const kind of ['person', 'asset'] as const) {
    const mine = valid.filter((l) => l.subject_kind === kind);
    const parent = new Map<string, string>();
    const find = (k: string): string => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
    const union = (x: string, y: string) => { const rx = find(x); const ry = find(y); if (rx !== ry) parent.set(rx > ry ? rx : ry, rx > ry ? ry : rx); };
    const keyA = (l: SubjectLink) => occurrenceKey(l.a.evidence_id, l.a.index);
    const keyB = (l: SubjectLink) => occurrenceKey(l.b.evidence_id, l.b.index);
    for (const l of mine) if (l.kind === 'SAME_SUBJECT') union(keyA(l), keyB(l));
    const badRoots = new Set(mine.filter((l) => l.kind === 'DIFFERENT_SUBJECT' && find(keyA(l)) === find(keyB(l))).map((l) => find(keyA(l))));
    for (const l of mine) {
      if (badRoots.has(find(keyA(l))) || badRoots.has(find(keyB(l)))) { skip(l, 'LINK_CYCLE'); continue; }
      const r: ResolvedLink = { correction_id: l.correction_id, a: keyA(l), b: keyB(l) };
      (l.kind === 'SAME_SUBJECT' ? out[kind].same : out[kind].different).push(r);
    }
  }
  return out;
}
