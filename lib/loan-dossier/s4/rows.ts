// Sinh dòng checklist và gán ứng viên (T-S4-05; S4-R03…R09, R20). Chưa tính trạng thái.
import { docTypeByKey } from '../catalog';
import { nameLevel, type NameLevel } from '../common/name';
import type { EvidenceEnvelope } from '../s2/common-schema';
import { loadChecklistCatalog, type ChecklistItem } from './catalog';
import { evidenceAssets, evidencePersons, type Asset, type ChecklistContext, type Person } from './context';

export interface Candidate {
  evidence_id: string | null;
  file_id: string;
  file_name: string;
  doc_type_key: string;
  page: number | null;
  field_path: string | null;
  status: 'SUCCESS' | 'ERROR';
  duplicate_group_id: string | null;
  duplicate_status: string | null;
  issue_date: string | null;
  valid_until: string | null;
  recognition_only: boolean;
  needs_manual_review: boolean;
}

export interface Row {
  item: ChecklistItem;
  person: Person | null;
  asset: Asset | null;
  /** Dòng ASSET: ngữ cảnh của dòng (null với tài sản chưa rõ ngữ cảnh / dòng không tài sản). */
  usage_context: string | null;
  /** Kết quả điều kiện đã định sẵn cho dòng tài sản (S4-R05, R06); null = tính theo điều kiện chung. */
  preset_condition: 'MET' | 'NOT_MET' | 'INPUT_NOT_PROVIDED' | null;
  candidates: Candidate[];
  /** Dòng PERSON: chứng từ đúng loại có trong hồ sơ nhưng chưa xác nhận thuộc người này (S4-R28). */
  held_back?: HeldBack[];
}

/** Chứng từ đúng loại bị loại khỏi `candidates` vì chưa gán chắc cho người đang chấm. */
export interface HeldBack {
  candidate: Candidate;
  why: 'NAME_SPELLING_DIFFERENCE' | 'AMBIGUOUS_IDENTITY_MATCH' | 'MULTIPLE_IDENTITIES_FOR_ROLE';
  /** Tên in trên chứng từ (chỉ với NAME_SPELLING_DIFFERENCE / AMBIGUOUS_IDENTITY_MATCH). */
  seen_name: string | null;
}

export interface ExcludedEvidence {
  evidence_id: string;
  doc_type_key: string;
  reason_code: string;
}

/** Bản S1 nhận là loại X nhưng S2 không thấy mẫu X ở các trang đó (FORM_NOT_FOUND) — S4-R26. */
export interface MisclassifiedEvidence {
  evidence_id: string;
  doc_type_key: string;
  file_name: string;
  page_range: [number, number];
}

const LEGAL_ROLES = ['borrower', 'co_borrower', 'collateral_owner'];
const personNo = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : Number(id.split('-')[1]));
const assetNo = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : Number(id.split('-')[1]));

function fromEvidence(e: EvidenceEnvelope, fieldPath: string | null): Candidate {
  const legal = e.data?.legal_info as { issue_date?: string | null; valid_until?: string | null } | null | undefined;
  return {
    evidence_id: e.evidence_id, file_id: e.file_id, file_name: e.file_name, doc_type_key: e.doc_type_key, page: e.page_range[0],
    field_path: fieldPath, status: e.status as 'SUCCESS' | 'ERROR', duplicate_group_id: e.duplicate_group_id, duplicate_status: e.duplicate_status,
    issue_date: legal?.issue_date ?? null, valid_until: legal?.valid_until ?? null, recognition_only: false, needs_manual_review: false,
  };
}

/** Bộ tra ứng viên dùng chung cho dòng chính và item thay thế (S4-R14 cùng phạm vi). */
export class CandidateIndex {
  private readonly persons: ReturnType<typeof evidencePersons>;
  private readonly assets: ReturnType<typeof evidenceAssets>;
  readonly excluded: ExcludedEvidence[] = [];
  private readonly excludedIds = new Set<string>();
  private readonly conflictExcluded = new Set<string>();
  private readonly lightByInstance = new Map<string, EvidenceEnvelope>();
  private readonly misclassified: MisclassifiedEvidence[] = [];
  private readonly ctx: ChecklistContext;

  constructor(ctx: ChecklistContext) {
    this.ctx = ctx;
    this.persons = evidencePersons(ctx.s3);
    this.assets = evidenceAssets(ctx.s3);
    for (const e of ctx.evidences) {
      if (e.extraction_level === 'LIGHT') this.lightByInstance.set(`${e.file_id}|${e.doc_type_key}|${e.instance_index}`, e);
      // S4-R26: không thấy mẫu biểu → không phải chứng từ loại đó; không là ứng viên của mục nào.
      if (e.status === 'ERROR' && e.reason_code === 'FORM_NOT_FOUND' && !this.excludedIds.has(e.evidence_id)) {
        this.excludedIds.add(e.evidence_id);
        this.excluded.push({ evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, reason_code: 'FORM_NOT_FOUND' });
        this.misclassified.push({ evidence_id: e.evidence_id, doc_type_key: e.doc_type_key, file_name: e.file_name, page_range: [e.page_range[0], e.page_range[1]] });
      }
    }
    // S4-R08: evidence unmapped / của người role_conflict không tính cho ai.
    for (const u of ctx.s3?.unmapped_evidences ?? []) {
      if (this.excludedIds.has(u.evidence_id)) continue;
      this.excludedIds.add(u.evidence_id);
      this.excluded.push({ evidence_id: u.evidence_id, doc_type_key: u.doc_type_key, reason_code: u.reason_code });
    }
    for (const p of ctx.s3?.role_registry ?? []) {
      if (!p.role_conflict) continue;
      for (const m of p.mapped_evidences as Array<{ evidence_id: string; doc_type_key: string }>) {
        if (m.doc_type_key === 'loan_application' || this.excludedIds.has(m.evidence_id)) continue;
        this.excludedIds.add(m.evidence_id);
        this.conflictExcluded.add(m.evidence_id);
        this.excluded.push({ evidence_id: m.evidence_id, doc_type_key: m.doc_type_key, reason_code: 'MULTIPLE_IDENTITIES_FOR_ROLE' });
      }
    }
  }

  /**
   * S4-R28 (D-64): chứng từ đúng loại có trong hồ sơ nhưng S3 chưa gán chắc cho người `person`, nên không vào `forPerson`:
   * (a) `unmapped_evidences` vì tên khác chính tả / khớp nhiều người, và tên trên chứng từ gần giống tên người này;
   * (b) bị loại vì một người cùng trên chứng từ có danh tính xung đột (`role_conflict`) mà người này vẫn được ghép vào chứng từ.
   * Dùng để báo "cần rà soát" thay vì "thiếu chứng từ".
   */
  heldBack(docTypes: readonly string[], person: Person): HeldBack[] {
    const out: HeldBack[] = [];
    const byId = new Map(this.ctx.evidences.map((e) => [e.evidence_id, e]));
    const names = [person.full_name, this.ctx.s3?.customer_360.find((c) => c.person_id === person.person_id)?.identity.full_name]
      .filter((n): n is string => Boolean(n?.trim()));
    const levelOf = (seen: string | null): NameLevel => {
      const rank: NameLevel[] = ['EXACT', 'REORDERED', 'SPELLING_DIFFERENCE', 'NO_MATCH'];
      return names.map((n) => nameLevel(seen, n)).sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] ?? 'NO_MATCH';
    };
    const seenEvidence = new Set<string>();
    // (a1) party chưa gán cho ai mà tên chỉ khác chính tả với người này — kể cả khi party khác trên cùng chứng từ đã ghép được
    // (VD giấy đăng ký kết hôn: chồng ghép được, vợ ghi "NGHIÊM" còn đề nghị vay "NGHIỆM").
    const mappedKeys = new Set<string>();
    for (const p of this.ctx.s3?.role_registry ?? []) {
      for (const m of p.mapped_evidences as Array<{ evidence_id: string; party_index: number }>) mappedKeys.add(`${m.evidence_id}#${m.party_index}`);
    }
    for (const e of this.ctx.evidences) {
      if (e.status !== 'SUCCESS' || !docTypes.includes(e.doc_type_key) || this.ctx.superseded.has(e.evidence_id) || seenEvidence.has(e.evidence_id)) continue;
      const parties = (e.data?.parties as Array<{ party_index: number; full_name: string | null }> | undefined) ?? [];
      const hit = parties.find((p) => !mappedKeys.has(`${e.evidence_id}#${p.party_index}`) && p.full_name && levelOf(p.full_name) === 'SPELLING_DIFFERENCE');
      if (!hit) continue;
      seenEvidence.add(e.evidence_id);
      out.push({ candidate: fromEvidence(e, `data.parties[${hit.party_index}]`), why: 'NAME_SPELLING_DIFFERENCE', seen_name: hit.full_name });
    }
    // (a2) S3 ghi nhận khớp nhiều người
    for (const u of this.ctx.s3?.unmapped_evidences ?? []) {
      if (!docTypes.includes(u.doc_type_key) || seenEvidence.has(u.evidence_id) || u.reason_code !== 'AMBIGUOUS_IDENTITY_MATCH') continue;
      const e = byId.get(u.evidence_id);
      if (!e || levelOf(u.full_name) === 'NO_MATCH') continue;
      seenEvidence.add(u.evidence_id);
      out.push({ candidate: fromEvidence(e, u.party_index === null ? null : `data.parties[${u.party_index}]`), why: 'AMBIGUOUS_IDENTITY_MATCH', seen_name: u.full_name });
    }
    for (const id of this.conflictExcluded) {
      const e = byId.get(id);
      const mine = this.persons.get(id)?.find((o) => o.person_id === person.person_id);
      if (!e || !mine || !docTypes.includes(e.doc_type_key) || seenEvidence.has(id)) continue;
      seenEvidence.add(id);
      out.push({ candidate: fromEvidence(e, `data.parties[${mine.party_index}]`), why: 'MULTIPLE_IDENTITIES_FOR_ROLE', seen_name: null });
    }
    return out;
  }

  /** Mọi ứng viên của các loại (chưa lọc phạm vi). Loại chỉ nhận diện lấy theo instance của S1. */
  private all(docTypes: readonly string[]): Array<{ c: Candidate; e: EvidenceEnvelope | null }> {
    const out: Array<{ c: Candidate; e: EvidenceEnvelope | null }> = [];
    for (const key of docTypes) {
      const dt = docTypeByKey(key);
      if (!dt) continue;
      if (dt.needs_extraction) {
        for (const e of this.ctx.evidences) {
          if (e.doc_type_key === key && !this.isMisclassified(e.evidence_id)) out.push({ c: fromEvidence(e, null), e });
        }
        continue;
      }
      for (const f of this.ctx.classify.files) {
        for (const m of f.matches) {
          if (m.doc_type_key !== key) continue;
          for (const inst of m.instances) {
            const e = this.lightByInstance.get(`${f.file_id}|${key}|${inst.instance_index}`) ?? null;
            if (e && this.isMisclassified(e.evidence_id)) continue;
            const legal = e?.status === 'SUCCESS' ? (e.data?.legal_info as { issue_date?: string | null; valid_until?: string | null } | null) : null;
            out.push({
              c: {
                evidence_id: e?.evidence_id ?? null, file_id: f.file_id, file_name: f.file_name, doc_type_key: key, page: inst.page_range[0],
                field_path: null, status: 'SUCCESS', duplicate_group_id: e?.duplicate_group_id ?? null, duplicate_status: e?.duplicate_status ?? null,
                issue_date: legal?.issue_date ?? null, valid_until: legal?.valid_until ?? null, recognition_only: true, needs_manual_review: m.needs_manual_review,
              },
              e,
            });
          }
        }
      }
    }
    return out;
  }

  forPerson(docTypes: readonly string[], personId: string | null): Candidate[] {
    const all = this.all(docTypes);
    if (personId === null) return all.map((x) => x.c); // chế độ dự phòng: mọi evidence cùng loại (S4-R07)
    const out: Candidate[] = [];
    for (const { c, e } of all) {
      if (c.evidence_id && this.excludedIds.has(c.evidence_id)) continue;
      const owners = c.evidence_id ? this.persons.get(c.evidence_id) ?? [] : [];
      const mine = owners.find((o) => o.person_id === personId);
      if (mine) { out.push({ ...c, field_path: `data.parties[${mine.party_index}]` }); continue; }
      // Evidence lỗi không gán được người → tính cho mọi người (cần scan lại) — S3 không ghép evidence ERROR.
      if (owners.length === 0 && (e?.status === 'ERROR' || !e)) out.push(c);
    }
    return out;
  }

  forAsset(docTypes: readonly string[], assetId: string | null, orphanOnly = false): Candidate[] {
    const out: Candidate[] = [];
    for (const { c } of this.all(docTypes)) {
      const links = c.evidence_id ? this.assets.get(c.evidence_id) ?? [] : [];
      if (assetId !== null) {
        const hit = links.find((l) => l.asset_id === assetId);
        if (hit) out.push({ ...c, field_path: `data.assets[${hit.asset_index}]` });
      } else if (!orphanOnly || links.length === 0) {
        out.push(c);
      }
    }
    return out;
  }

  forDossier(docTypes: readonly string[]): Candidate[] {
    return this.all(docTypes).map((x) => x.c);
  }

  private isMisclassified(evidenceId: string): boolean {
    return this.misclassified.some((m) => m.evidence_id === evidenceId);
  }

  /** Bản bị nhận nhầm là một trong các loại (S4-R26), để ghi chú cho dòng MISSING. */
  misclassifiedOf(docTypes: readonly string[]): MisclassifiedEvidence[] {
    return this.misclassified.filter((m) => docTypes.includes(m.doc_type_key));
  }
}

/** Dòng của checklist theo flow, thứ tự S4-R20. */
export function buildRows(items: readonly ChecklistItem[], ctx: ChecklistContext, index: CandidateIndex): Row[] {
  const groupOrder = loadChecklistCatalog().groups.map((g) => g.checklist_group);
  const rows: Row[] = [];
  const s3 = ctx.s3;
  const legalPersons: Array<Person | null> = ctx.subjectMapping
    ? (s3?.role_registry ?? []).filter((p) => p.roles.some((r) => LEGAL_ROLES.includes(r))).sort((a, b) => personNo(a.person_id) - personNo(b.person_id))
    : [null];
  const assets = s3?.asset_registry ?? [];

  for (const group of groupOrder) {
    const groupItems = items.filter((it) => it.checklist_group === group);
    if (group === 'legal') {
      for (const p of legalPersons) {
        for (const it of [...groupItems].sort((a, b) => a.item_no - b.item_no)) {
          rows.push({
            item: it, person: p, asset: null, usage_context: null, preset_condition: null,
            candidates: index.forPerson(it.accepted_doc_type_keys, p?.person_id ?? null),
            held_back: p ? index.heldBack(it.accepted_doc_type_keys, p) : [],
          });
        }
      }
      continue;
    }
    for (const it of groupItems) {
      if (it.scope !== 'ASSET') {
        rows.push({ item: it, person: null, asset: null, usage_context: null, preset_condition: null, candidates: index.forDossier(it.accepted_doc_type_keys) });
        continue;
      }
      const conditional = it.condition_id !== null;
      if (!ctx.assetMapping) {
        // S4-R06
        rows.push({ item: it, person: null, asset: null, usage_context: null, preset_condition: conditional ? 'INPUT_NOT_PROVIDED' : null, candidates: index.forAsset(it.accepted_doc_type_keys, null) });
        continue;
      }
      const itemRows: Row[] = [];
      for (const a of assets) {
        if (!it.asset_types.includes(a.asset_type)) continue;
        const ctxs = a.usage_contexts as string[];
        if (it.usage_context && ctxs.includes(it.usage_context)) {
          itemRows.push({ item: it, person: null, asset: a, usage_context: it.usage_context, preset_condition: conditional ? 'MET' : null, candidates: index.forAsset(it.accepted_doc_type_keys, a.asset_id) });
        } else if (ctxs.length === 0 && group === 'collateral') {
          // S4-R05(a): tài sản chưa rõ ngữ cảnh → chỉ ở nhóm collateral
          itemRows.push({ item: it, person: null, asset: a, usage_context: null, preset_condition: conditional ? 'INPUT_NOT_PROVIDED' : null, candidates: index.forAsset(it.accepted_doc_type_keys, a.asset_id) });
        }
      }
      if (group === 'collateral') {
        // S4-R05(b): evidence mồ côi (không thuộc sources của tài sản nào)
        const orphans = index.forAsset(it.accepted_doc_type_keys, null, true);
        if (orphans.length > 0) itemRows.push({ item: it, person: null, asset: null, usage_context: null, preset_condition: conditional ? 'INPUT_NOT_PROVIDED' : null, candidates: orphans });
      }
      if (itemRows.length === 0) {
        // S4-R05(c)
        itemRows.push({ item: it, person: null, asset: null, usage_context: null, preset_condition: conditional ? 'NOT_MET' : null, candidates: [] });
      }
      itemRows.sort((x, y) => assetNo(x.asset?.asset_id ?? null) - assetNo(y.asset?.asset_id ?? null));
      rows.push(...itemRows);
    }
  }
  return rows;
}
