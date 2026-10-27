import {
  parseSupplementalReportTitleAliases,
  validateSupplementalReportTitleAliases,
} from '@/lib/pipelines/workflows/financial-report/types';
import { resolveConfig, matchesAliasStrongly } from '@/lib/pipelines/workflows/financial-report-translation';
import {
  buildClassifyPrompt,
  buildClassifyRecheckPrompt,
  buildExtractPrompt,
} from '@/lib/pipelines/workflows/prompts/financial-report-prompts';

const supplemental = { balanceSheet: ['Custom Statement of Position'] };

describe('Round 14 C1 — supplemental report-title aliases', () => {
  it('accepts a bounded JSON map and rejects malformed, ambiguous, or unsafe aliases', () => {
    expect(validateSupplementalReportTitleAliases(JSON.stringify(supplemental))).toEqual({
      ok: true,
      value: supplemental,
    });

    for (const invalid of [
      '{',
      JSON.stringify({ unknownReport: ['Custom Statement'] }),
      JSON.stringify({ balanceSheet: [''] }),
      JSON.stringify({ balanceSheet: ['12345'] }),
      JSON.stringify({ balanceSheet: ['---'] }),
      JSON.stringify({ balanceSheet: ['Bad\nTitle'] }),
      JSON.stringify({ balanceSheet: ['Custom Statement', 'custom-statement'] }),
    ]) {
      expect(validateSupplementalReportTitleAliases(invalid).ok).toBe(false);
    }
  });

  it('reads the Profile-style JSON string but fails closed for malformed runtime values', () => {
    const ctx = (pipelineVars: Record<string, unknown>) => ({ operationId: 'c1-op', pipelineVars }) as never;

    expect(resolveConfig(ctx({ supplemental_report_title_aliases: JSON.stringify(supplemental) })))
      .toMatchObject({ supplementalReportTitleAliases: supplemental });
    expect(resolveConfig(ctx({ supplemental_report_title_aliases: '{invalid' })))
      .toMatchObject({ supplementalReportTitleAliases: {} });
    expect(parseSupplementalReportTitleAliases({ balanceSheet: [] })).toEqual({});
  });

  it('appends configured aliases to normal and recheck classifier prompts without removing core aliases', () => {
    const prompt = buildClassifyPrompt(1, 1, 5, undefined, undefined, supplemental)._prompt as string;
    const recheck = buildClassifyRecheckPrompt(2, 2, 5, [], undefined, undefined, supplemental)._prompt as string;

    for (const rendered of [prompt, recheck]) {
      expect(rendered).toContain('Custom Statement of Position');
      expect(rendered).toContain('貸借対照表');
      expect(rendered).toContain('Balance Sheet');
    }
  });

  it('does not widen extract or Notes-table alias safety beyond the immutable core aliases', () => {
    expect(buildExtractPrompt('balanceSheet', 1, 1, false, [])._prompt).not.toContain('Custom Statement of Position');
    expect(matchesAliasStrongly('Custom Statement of Position', 'balanceSheet')).toBe(false);
    expect(matchesAliasStrongly('Statement of Financial Position', 'balanceSheet')).toBe(true);
  });
});
