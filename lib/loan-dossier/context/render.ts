// Văn bản của LAC cho prompt LLM + bảng mã F<n> → record_id (LAC-R11…R15; D-103). Hàm thuần, tất định: cùng (LAC, scope,
// budget, hồ sơ 360) → cùng text và cùng bảng mã, nên bước parse dựng lại được bảng mã kể cả khi resume. Không log; nguồn ghi bằng
// doc_type_key, không có tên file hay evidence_id.
// D-114: có hồ sơ 360 thì nguồn thu và hộ kinh doanh render theo ĐƠN VỊ của hồ sơ 360 (luồng `inc-n`, đơn vị `biz-n`, mỗi luồng một dòng,
// giữ danh tính dòng), không còn các fact `income_sources[].*` làm phẳng và chủ thể `business-1`; model thấy đúng cấu trúc người thẩm định thấy.
import type { Profile360 } from '../profile360/schema';
import type { LacFact, LacSubject, LacTrust, LoanApplicationContext } from './schema';
import { factInScope, subjectInScope, type LacScope } from './scope';

export const LAC_CHAR_BUDGET = 18_000;
const MAX_VALUE_LENGTH = 160;

export interface LacRenderStats {
  chars: number;
  facts_rendered: number;
  facts_in_scope: number;
  conflicts: number;
  gaps: number;
  truncated: boolean;
  subjects: Record<string, number>;
}

export interface LacRender {
  text: string;
  /** "F<n>" → record_id của mọi nguồn còn hiệu lực; "F<n>.<k>" → nguồn thứ k (1-based) theo thứ tự hiển thị. */
  refIndex: Map<string, string[]>;
  /** "F<n>" → fact_id (để parse áp rào theo trust / review). */
  factIndex: Map<string, string>;
  stats: LacRenderStats;
}

const NOTE = 'Ký hiệu: F<n> là mã dữ kiện, dẫn nguồn bằng mã này (VD "F3"; "F3.2" = chứng từ thứ 2 của F3). '
  + 'Trạng thái: CORROBORATED = ≥2 loại chứng từ khớp · SINGLE_SOURCE = 1 loại chứng từ · DECLARED = chỉ có lời khai của khách hàng (đơn vay, bảng kê) · '
  + 'DISPUTED = các chứng từ ghi khác nhau · PROBABLE_OCR_ERROR = nghi đọc sai 1 ký tự · SPELLING_VARIANT = khác cách viết · '
  + '"cần soát" = độ tin cậy đọc thấp. person-n / asset-n là người / tài sản đã được hệ thống gom: cùng một chủ thể trên mọi chứng từ. '
  + 'inc-n là một luồng thu nhập (đã gộp các chứng từ cùng nguồn, chỉ tính một lần); biz-n là một hộ kinh doanh.';

const GAP_TEXT: Record<string, string> = {
  NO_LOAN_APPLICATION: 'không có giấy đề nghị vay đọc được: chưa xác định được vai trò từng người',
  S3_UNAVAILABLE: 'chưa gom được người & tài sản: dữ kiện chỉ theo từng chứng từ',
  PARTY_NOT_MAPPED: 'người trên chứng từ chưa gắn được vào hồ sơ',
  ASSET_NOT_MAPPED: 'tài sản trên chứng từ chưa gắn được vào hồ sơ',
  EVIDENCE_READ_ERROR: 'chứng từ không đọc được',
  SUPERSEDED_EVIDENCE: 'bản đã bị thay thế bởi bản mới hơn (dữ kiện của bản cũ không hiển thị)',
  LOAN_APPLICATION_DUPLICATE: 'nhiều giấy đề nghị vay ghi khác nhau về khoản vay',
};
const RELATION_TEXT: Record<string, string> = {
  OWNS: 'chủ sở hữu hiện tại', OWNED_FORMERLY: 'từng đứng tên', SPOUSE_OF: 'vợ/chồng', RELATIVE_OF: 'nhân thân', LEGAL_REP_OF: 'người đại diện theo pháp luật',
};
const SECTION: Record<LacSubject['kind'], string> = { loan: 'KHOẢN VAY', business: 'HOẠT ĐỘNG KINH DOANH', person: 'NGƯỜI', asset: 'TÀI SẢN', document: 'CHỨNG TỪ KHÁC' };
const KIND_ORDER: LacSubject['kind'][] = ['loan', 'business', 'person', 'asset', 'document'];
/** Ưu tiên giữ lại khi vượt ngân sách (LAC-R14 bước 5). */
const TRUST_PRIORITY: LacTrust[] = ['DISPUTED', 'PROBABLE_OCR_ERROR', 'CORROBORATED', 'SINGLE_SOURCE', 'DECLARED', 'SPELLING_VARIANT'];

const evidenceIdOf = (recordId: string) => recordId.split('#')[0];
const one = (v: unknown): string => {
  const s = String(v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH)}…` : s;
};

function liveSources(f: LacFact, superseded: ReadonlySet<string>) {
  const live = f.sources.filter((s) => !superseded.has(evidenceIdOf(s.record_id)));
  return live.length > 0 ? live : f.sources;
}

function sourceList(f: LacFact, superseded: ReadonlySet<string>): string {
  const counts = new Map<string, number>();
  for (const s of liveSources(f, superseded)) counts.set(s.doc_type_key, (counts.get(s.doc_type_key) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
}

function subjectLine(s: LacSubject): string {
  const parts = [s.subject_id, ...(s.roles.length ? [s.roles.join('/')] : []), one(s.label)];
  if (s.flags.length) parts.push(`lưu ý: ${s.flags.join(', ')}`);
  return parts.join(' · ');
}

export function renderLoanApplicationContext(
  lac: LoanApplicationContext,
  scope: LacScope,
  budget = LAC_CHAR_BUDGET,
  /** Hồ sơ 360 của cùng lần chạy (D-114). null → render như trước (fact phẳng, `business-1`). */
  profile: Profile360 | null = null,
): LacRender {
  const superseded = new Set(lac.meta.superseded_evidence_ids);

  // ── D-114: fact nào được trình bày qua luồng thu nhập / hộ kinh doanh của hồ sơ 360 ──
  const factOfRecord = new Map(lac.facts.flatMap((f) => f.sources.map((src) => [src.record_id, f.fact_id] as const)));
  const structured = new Set<string>();
  for (const st of profile?.income_streams ?? []) {
    for (const a of st.amounts) a.fact_ids.forEach((id) => structured.add(id));
    st.employer?.fact_ids.forEach((id) => structured.add(id));
    for (const b of [st.annual_profit, st.annual_revenue]) b?.record_ids.forEach((r) => { const id = factOfRecord.get(r); if (id) structured.add(id); });
  }
  for (const u of profile?.business_units ?? []) {
    for (const f of [u.name, u.registration_number, u.tax_id, u.business_line, u.business_address]) f.fact_ids.forEach((id) => structured.add(id));
  }
  const repayment = profile !== null && (profile.income_streams.length > 0 || profile.business_units.length > 0)
    && (scope.all || scope.business || scope.personIncome || scope.personRoles !== null);
  /** Có hồ sơ 360: dòng phẳng của nguồn thu / `business-1` không render riêng — nằm trong mục NGUỒN TRẢ NỢ. */
  const folded = (f: LacFact) => profile !== null && (f.field.startsWith('income_sources[]') || f.subject_id === 'business-1' || structured.has(f.fact_id));

  const subjectById = new Map(lac.subjects.map((s) => [s.subject_id, s]));
  const live = (f: LacFact) => !f.hidden && f.trust !== 'SUPERSEDED';
  const renderable = (f: LacFact) => live(f) && !folded(f);
  const inScope = lac.facts.filter((f) => renderable(f) && factInScope(scope, f, subjectById.get(f.subject_id)));
  const conflictFactIds = new Set(lac.conflicts.flatMap((c) => c.fact_ids));
  const factById = new Map(lac.facts.map((f) => [f.fact_id, f]));

  // ── Chọn fact theo ngân sách: fact của mâu thuẫn và của mục NGUỒN TRẢ NỢ luôn giữ; còn lại theo trust rồi xoay vòng giữa chủ thể ──
  const factLine = (code: string, f: LacFact) => `${code} ${f.label} = ${one(f.value)} [${f.trust}; ${sourceList(f, superseded)}${f.review === 'REVIEW' ? '; cần soát' : ''}]`;
  const estimate = (f: LacFact) => factLine('F000', f).length + 1;
  const selected = new Set<string>();
  const mandatory = lac.facts.filter((f) => live(f) && (conflictFactIds.has(f.fact_id) || (repayment && structured.has(f.fact_id))));
  const subjectsShown = lac.subjects.filter((s) => s.kind !== 'document' && !(profile && s.kind === 'business')
    && (subjectInScope(scope, s) || inScope.some((f) => f.subject_id === s.subject_id) || mandatory.some((f) => f.subject_id === s.subject_id && !folded(f))));
  const repaymentLines = repayment ? profile!.income_streams.length + profile!.business_units.length : 0;
  const fixedCost = NOTE.length + lac.gaps.length * 90 + lac.conflicts.length * 140 + subjectsShown.length * 80 + lac.relations.length * 90 + repaymentLines * 120 + 200;
  let used = fixedCost;
  for (const f of mandatory) { selected.add(f.fact_id); used += folded(f) ? 12 : estimate(f); }

  const tierOf = (f: LacFact) => (subjectById.get(f.subject_id)?.kind === 'document' ? TRUST_PRIORITY.length : TRUST_PRIORITY.indexOf(f.trust));
  let truncated = false;
  for (let tier = 0; tier <= TRUST_PRIORITY.length; tier += 1) {
    const queues = new Map<string, LacFact[]>();
    for (const f of inScope) if (!selected.has(f.fact_id) && tierOf(f) === tier) queues.set(f.subject_id, [...(queues.get(f.subject_id) ?? []), f]);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const queue of queues.values()) {
        const f = queue.shift();
        if (!f) continue;
        progressed = true;
        const cost = estimate(f);
        if (used + cost > budget) { truncated = true; continue; }
        selected.add(f.fact_id);
        used += cost;
      }
    }
  }

  // ── Gán mã F<n> theo thứ tự hiển thị (mục → chủ thể → thứ tự fact) ──
  const codeOf = new Map<string, string>();
  const refIndex = new Map<string, string[]>();
  const factIndex = new Map<string, string>();
  const ordered = [...lac.subjects].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const s of ordered) {
    for (const f of lac.facts) {
      if (f.subject_id !== s.subject_id || !selected.has(f.fact_id)) continue;
      const code = `F${codeOf.size + 1}`;
      codeOf.set(f.fact_id, code);
      factIndex.set(code, f.fact_id);
      const src = liveSources(f, superseded);
      refIndex.set(code, src.map((x) => x.record_id));
      src.forEach((x, k) => refIndex.set(`${code}.${k + 1}`, [x.record_id]));
    }
  }
  const ref = (factId: string) => codeOf.get(factId) ?? '(không hiển thị)';
  const refs = (ids: readonly string[]) => [...new Set(ids.map((id) => codeOf.get(id)).filter((x): x is string => !!x))].join(', ');

  // ── Văn bản ──
  const out: string[] = [NOTE];
  if (lac.gaps.length) {
    out.push('', 'KHOẢNG TRỐNG');
    for (const g of lac.gaps) out.push(`- ${g.code} ×${g.count}${g.subject_id ? ` (${g.subject_id})` : ''}: ${GAP_TEXT[g.code] ?? ''}`);
  }
  if (lac.conflicts.length) {
    out.push('', 'MÂU THUẪN');
    for (const c of lac.conflicts) {
      const values = c.fact_ids.map((id) => {
        const f = factById.get(id)!;
        const docs = new Set(liveSources(f, superseded).map((s) => evidenceIdOf(s.record_id))).size;
        return `${ref(id)} "${one(f.value)}" (${docs} chứng từ)`;
      });
      out.push(`- ${c.subject_id} · ${factById.get(c.fact_ids[0])?.label ?? c.field}: ${values.join(' ≠ ')} — ${c.kind}`);
    }
  }
  const dropped = new Map<string, number>();
  for (const f of inScope) if (!selected.has(f.fact_id)) dropped.set(f.subject_id, (dropped.get(f.subject_id) ?? 0) + 1);
  // D-114: nguồn trả nợ theo hồ sơ 360 — mỗi luồng / mỗi hộ kinh doanh một dòng, dẫn nguồn bằng mã F<n> của các fact đã gom vào nó.
  // Đặt sau NGƯỜI, trước TÀI SẢN / CHỨNG TỪ KHÁC: cùng trục đọc với Customer 360 (khoản vay → khách hàng → nguồn trả nợ → tài sản).
  let repaymentDone = false;
  const emitRepayment = () => {
    if (repaymentDone) return;
    repaymentDone = true;
    if (repayment && profile) {
      const cite = (ids: readonly string[]) => { const r = refs(ids); return r ? ` [${r}]` : ''; };
      const recordFacts = (records: readonly string[]) => records.map((r) => factOfRecord.get(r)).filter((x): x is string => !!x);
      if (profile.income_streams.length) {
        out.push('', 'NGUỒN TRẢ NỢ (mỗi luồng tính một lần)');
        for (const st of profile.income_streams) {
          const parts = [st.income_id, st.kind, st.person_id ?? 'chưa rõ của ai'];
          if (st.business_id) parts.push(st.business_id);
          if (st.employer?.value) parts.push(`bên trả lương "${one(st.employer.value)}"${cite(st.employer.fact_ids)}`);
          parts.push(st.monthly_amount === null ? 'không có số tiền' : `${st.monthly_amount}/tháng${cite(st.amounts.flatMap((a) => a.fact_ids))}`);
          if (st.annual_profit) parts.push(`lợi nhuận năm ${st.annual_profit.value}${cite(recordFacts(st.annual_profit.record_ids))}`);
          if (st.annual_revenue) parts.push(`doanh thu năm ${st.annual_revenue.value}${cite(recordFacts(st.annual_revenue.record_ids))}`);
          parts.push(st.evidenced ? 'có chứng từ chứng minh' : 'chỉ lời khai');
          out.push(`- ${parts.join(' · ')}`);
        }
      }
      if (profile.business_units.length) {
        out.push('', profile.business_units.some((u) => u.kind === 'ENTERPRISE') ? 'ĐƠN VỊ KINH DOANH' : 'HỘ KINH DOANH');
        for (const u of profile.business_units) {
          const field = (label: string, f: (typeof u)['name']) => (f.value !== null ? `${label} ${one(f.value)}${cite(f.fact_ids)}` : f.trust === 'DISPUTED' ? `${label} ghi khác nhau${cite(f.fact_ids)}` : null);
          const verified = profile.relations.some((r) => r.type === 'OPERATES' && r.to === u.business_id && r.verification === 'VERIFIED');
          const parts = [u.business_id, u.kind === 'ENTERPRISE' ? 'doanh nghiệp' : null, field('tên', u.name), field('số GCN', u.registration_number), field('MST', u.tax_id), field('ngành', u.business_line), field('địa điểm', u.business_address),
            `chủ ${u.owner_person_ids.join(', ') || 'chưa xác định'} (${verified ? 'đã xác minh bằng GCN' : 'chưa xác minh'})`, ...(u.flags.length ? [`lưu ý: ${u.flags.join(', ')}`] : [])];
          out.push(`- ${parts.filter(Boolean).join(' · ')}`);
        }
      }
    }
  };

  let lastKind: string | null = null;
  const docSubjects = ordered.filter((s) => s.kind === 'document' && lac.facts.some((f) => f.subject_id === s.subject_id && selected.has(f.fact_id) && !folded(f)));
  for (const s of [...subjectsShown.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)), ...docSubjects]) {
    if (s.kind === 'asset' || s.kind === 'document') emitRepayment();
    if (s.kind !== lastKind) { out.push('', s.kind === 'loan' || s.kind === 'business' ? `${SECTION[s.kind]} [${s.subject_id}]` : SECTION[s.kind]); lastKind = s.kind; }
    if (s.kind !== 'loan' && s.kind !== 'business') out.push(subjectLine(s));
    for (const f of lac.facts) if (f.subject_id === s.subject_id && selected.has(f.fact_id) && !folded(f)) out.push(factLine(codeOf.get(f.fact_id)!, f));
    const n = dropped.get(s.subject_id);
    if (n) out.push(`(… còn ${n} dữ kiện của ${s.subject_id} không hiển thị)`);
  }
  emitRepayment();

  const relations = lac.relations.filter((r) => scope.all || scope.relations || subjectsShown.some((s) => s.subject_id === r.from || s.subject_id === r.to));
  if (relations.length) {
    out.push('', 'QUAN HỆ');
    for (const r of relations) {
      const support = r.support_fact_ids.map((id) => codeOf.get(id)).filter((x): x is string => !!x);
      const verify = r.verification.status !== 'NOT_REQUIRED' ? ` (${r.verification.status}${r.verification.detail ? `: ${r.verification.detail}` : ''})` : '';
      const arrow = r.type === 'SPOUSE_OF' ? '⇄' : '→';
      out.push(`- ${r.from} ${arrow} ${r.to}: ${RELATION_TEXT[r.type]}${verify} — ${support.length ? `căn cứ ${support.join(', ')}` : 'chưa có căn cứ dẫn được'}`);
    }
  }

  const text = out.join('\n');
  const subjects: Record<string, number> = {};
  for (const s of lac.subjects) subjects[s.kind] = (subjects[s.kind] ?? 0) + 1;
  return {
    text,
    refIndex,
    factIndex,
    stats: { chars: text.length, facts_rendered: selected.size, facts_in_scope: inScope.length, conflicts: lac.conflicts.length, gaps: lac.gaps.length, truncated, subjects },
  };
}
