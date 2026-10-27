import { comparePair, parsePairs, renderReports } from '../../scripts/lib/lac-compare';
const pair = { label: 'HS-01', off: 'op-off', on: 'op-on' };
const rule = (rule_id: string, result: string, reason_code = 'OK', extra = {}) => ({ rule_id, result, reason_code, check_kind: 'PROMPT', evidence_ids: ['e1'], confidence: 0.9, message: 'PRIVATE_SENTINEL', actual: 'PRIVATE_SENTINEL', ...extra });
function operation(rules: unknown[], on = false, state = 'SUCCEEDED') {
  return {
    metadata: { state, pipeline_steps: [{ stage_key: 'evaluate_policy_compliance', content_preview: {
      prompt_evidence: { chars: 100 }, lac: { chars: 110, facts_rendered: 5, truncated: false }, fact_value: 'PRIVATE_SENTINEL',
    } }] },
    result: { extracted_data: { policy_compliance: { rule_results: rules }, loan_application_context_summary: {
      fact_count: 6, conflicts: 1, gaps: [{ code: 'GAP', count: 2, message: 'PRIVATE_SENTINEL' }],
    } }, usage: { input_tokens: on ? 120 : 100, output_tokens: 20, cost_usd: 0.01 } },
  };
}
const off = () => operation([rule('A','PASS'), rule('B','REVIEW','PROMPT_CHECK_EVIDENCE_MISSING'), rule('C','FAIL'), rule('D','PASS'), rule('ENGINE','FAIL','OK',{check_kind:'DETERMINISTIC'})]);
const on = () => operation([rule('D','PASS','PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED',{evidence_ids: [],confidence:0}), rule('C','INSUFFICIENT_DATA'), rule('B','PASS'), rule('A','REVIEW')], true);
describe('LAC comparison', () => {
  test('matches PROMPT rules by id and projects only allowed counts/codes', () => {
    const result = comparePair(pair,off(),on());
    expect(result.rows.map(r => r.rule_id)).toEqual(['A','B','C','D']);
    expect(result.rows.map(r => r.changed)).toEqual([true,true,true,false]);
    expect(result.rows[3].on).toEqual({outcome:'PASS',reason:'PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED',evidence:0,confidence:0});
    expect(result.on.metrics).toMatchObject({facts_rendered:5,fact_count:6,conflicts:1,gaps:2,truncated:false,tokens:140,cost_usd:0.01});
    const report = renderReports([result]);
    expect(report.summary).toBe([
      'Pairs compared: 1; skipped: 0',
      'Rules compared: 4; unmatched: 0; outcome changed: 3',
      'PASS -> REVIEW: 1; REVIEW -> PASS: 1; other: 1',
      'PROMPT_CHECK_EVIDENCE_MISSING off/on: 1 / 0',
      'PROMPT_CHECK_EVIDENCE_NOT_ACCEPTED off/on: 0 / 1',
      'Average prompt chars off/on: 100 (n=1) / 110 (n=1)',
      'Average tokens off/on: 120 (n=1) / 140 (n=1)',
    ].join('\n'));
    expect(report.markdown).toContain('## Cần CO chấm');
    expect(report.csv.split('\r\n')).toHaveLength(6);
    expect(JSON.stringify(result)+report.markdown+report.csv).not.toContain('PRIVATE_SENTINEL');
  });
  test('skips incomplete pairs and excludes their metrics', () => {
    const p = comparePair(pair,operation([],false,'RUNNING'),on());
    expect(p.skipped).toBe(true);
    const report = renderReports([p]);
    expect(report.summary).toContain('Pairs compared: 0; skipped: 1');
    expect(report.summary).toContain('N/A (n=0)');
    expect(report.markdown).toContain('Skipped: off=RUNNING; on=SUCCEEDED');
  });
  test('unmatched rules are visible but never counted as outcome changes', () => {
    const p = comparePair(pair,operation([rule('ONLY_OFF','PASS')]),operation([rule('ONLY_ON','FAIL')]));
    expect(renderReports([p]).summary).toContain('Rules compared: 0; unmatched: 2; outcome changed: 0');
    expect(renderReports([p]).csv).toContain('UNMATCHED');
  });
  test('missing measurements stay null, zero measurements remain zero', () => {
    const raw = {metadata:{state:'SUCCEEDED'},result:{extracted_data:{policy_compliance:{rule_results:[]}},usage:{total_tokens:0,cost_usd:0}}};
    const p = comparePair(pair,raw,raw);
    expect(p.off.metrics).toMatchObject({tokens:0,cost_usd:0,lac_chars:null});
    expect(renderReports([p]).summary).toContain('Average tokens off/on: 0 (n=1) / 0 (n=1)');
  });
  test('rejects malformed input, duplicate rules and missing result contract', () => {
    expect(parsePairs([pair])).toEqual([pair]);
    expect(() => parsePairs([{...pair,label:'unsafe\nlabel'}])).toThrow();
    expect(() => parsePairs({})).toThrow();
    expect(() => comparePair(pair,operation([rule('A','PASS'),rule('A','FAIL')]),on())).toThrow('duplicate');
    expect(() => comparePair(pair,{metadata:{state:'SUCCEEDED'}},on())).toThrow('rule_results');
  });
});
