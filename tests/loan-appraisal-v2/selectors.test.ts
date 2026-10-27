import type { AppraisalResult, EvidenceRecord } from '@/app/loan-appraisal/types';
import {
  buildEvidenceLookup,
  collectExceptions,
  customerNameFrom,
  filesForKey,
  humanizeKey,
  readinessMeta,
  renderValue,
  safeArray,
  sourceDocumentsOf,
} from '@/app/loan-appraisal-v2/lib/selectors';

const record = (id: string, extra: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  evidence_id: id, field_path: 'a.b', value: 1, normalized_value: 1, file_name: `${id}.pdf`,
  doc_type_key: 'k', doc_type_label: 'Loại', classification_confidence: 1, extraction_method: 'AI_EXTRACT', review_status: 'ACCEPTED', ...extra,
});

describe('selectors', () => {
  it('basic helpers', () => {
    expect(safeArray(null)).toEqual([]);
    expect(humanizeKey('full_name')).toBe('Full Name');
    expect(renderValue(null)).toBe('—');
    expect(renderValue({ a: 1 })).toBe('{"a":1}');
    expect(readinessMeta('NEEDS_DOCUMENTS').tone).toBe('warning');
    expect(readinessMeta(undefined).label).toBe('Chưa xác định');
  });

  it('customerNameFrom is safe on empty fixtures', () => {
    expect(customerNameFrom(null)).toBeNull();
    expect(customerNameFrom({} as AppraisalResult)).toBeNull();
    expect(customerNameFrom({ customer_360: { customer_360: [{ roles: ['borrower'], identity: { full_name: ' An ' } }] } } as unknown as AppraisalResult)).toBe('An');
  });

  it('filesForKey prefers result checklist, falls back to classification', () => {
    const result = { checklist: { items: [{ item_key: 'credit_cic_report', found_in: [{ file_name: 'x.pdf' }] }] } } as unknown as AppraisalResult;
    expect(filesForKey('credit_cic_report', null, result)).toEqual(['x.pdf']);
    const cls = [{ file_name: 'y.pdf', status: 'classified', matches: [{ key: 'id_card', label: '', confidence: 1 }] }] as never;
    expect(filesForKey('id_card', cls, null)).toEqual(['y.pdf']);
    expect(filesForKey('none', null, null)).toEqual([]);
  });

  it('sourceDocumentsOf dedupes, resolves checklist evidence, counts unresolved', () => {
    const lookup = buildEvidenceLookup([
      record('e1'), record('e1b', { file_name: 'e1.pdf' }),
      record('c1', { evidence_kind: 'CHECKLIST_STATUS', source_evidence_ids: ['e1'], file_name: 'virtual' }),
    ]);
    const out = sourceDocumentsOf(['e1', 'e1b', 'c1', 'missing'], lookup);
    expect(out.documents).toHaveLength(1);
    expect(out.unresolved).toBe(1);
    expect(sourceDocumentsOf(undefined, lookup)).toEqual({ documents: [], unresolved: 0 });
  });

  it('collectExceptions merges conflicts, policy and supplements', () => {
    const result = {
      dossier_readiness: {
        conflicts: [{ severity: 'error', title: 'T', message: 'M', documents: [], evidence_ids: [] }, { severity: 'info', title: 'i', message: '', documents: [], evidence_ids: [] }],
        supplement_requests: ['Bổ sung A'],
      },
      policy_compliance: { rule_results: [
        { rule_id: 'R1', result: 'FAIL', message: 'Fail', expected: 1, actual: 2, reason_code: 'X' },
        { rule_id: 'R2', result: 'PASS', message: 'ok', reason_code: 'Y' },
      ] },
    } as unknown as AppraisalResult;
    const items = collectExceptions(result);
    expect(items.map((i) => i.id)).toEqual(['X1', 'R1', 'B1']);
    expect(items[1].detail).toContain('Yêu cầu: 1');
    expect(collectExceptions(null)).toEqual([]);
    expect(collectExceptions({} as AppraisalResult)).toEqual([]);
  });
});
