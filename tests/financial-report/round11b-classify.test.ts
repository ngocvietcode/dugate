import {
  applyDeterministicContinuations,
} from '@/lib/pipelines/workflows/financial-report/classify';
import { buildClassifyPrompt } from '@/lib/pipelines/workflows/prompts/financial-report-prompts';
import type { ClassifyPageLabel } from '@/lib/pipelines/workflows/financial-report/types';

describe('Round 11B / T2.2 — deterministic classify continuation', () => {
  it('requires the model to state whether each page has a numeric table', () => {
    const prompt = buildClassifyPrompt(3, 3, 10)._prompt as string;

    expect(prompt).toContain('"hasTable"');
    expect(prompt).toContain('nhãn khoản mục + cột số');
  });

  it('continues only a table page from the resolved immediate predecessor regardless of input order', () => {
    const labels: ClassifyPageLabel[] = [
      { page: 3, reportType: 'balanceSheet', basis: 'TITLE', titleFound: '連結貸借対照表', hasTable: true },
      { page: 4, reportType: null, basis: 'NONE', titleFound: null, hasTable: true },
      { page: 5, reportType: null, basis: 'NONE', titleFound: null, hasTable: false },
    ];

    const expected = [
      { page: 3, reportType: 'balanceSheet', basis: 'TITLE', titleFound: '連結貸借対照表', hasTable: true },
      { page: 4, reportType: 'balanceSheet', basis: 'CONTINUATION', titleFound: null, hasTable: true },
      { page: 5, reportType: null, basis: 'NONE', titleFound: null, hasTable: false },
    ];

    expect(applyDeterministicContinuations(labels)).toEqual(expected);
    expect(applyDeterministicContinuations([...labels].reverse())).toEqual(expected);
  });
});


import {
  deriveUnassignedPageReasons,
  selectRecheckRanges,
} from '@/lib/pipelines/workflows/financial-report/classify';

describe('Round 11B / T2.3 — unassigned page taxonomy', () => {
  it('derives the approved reason taxonomy from retained page labels', () => {
    const reasons = deriveUnassignedPageReasons(
      [1, 4, 5, 6],
      [
        { page: 1, reportType: null, basis: 'NONE', titleFound: null, blank: true, hasTable: false },
        { page: 4, reportType: null, basis: 'NONE', titleFound: null, blank: false, hasTable: true },
        { page: 5, reportType: null, basis: 'NONE', titleFound: 'Chính sách kế toán', blank: false, hasTable: false },
        { page: 6, reportType: null, basis: 'NONE', titleFound: 'Contents', blank: false, hasTable: false },
      ],
    );

    expect(reasons).toEqual([
      { page: 1, reason: 'BLANK' },
      { page: 4, reason: 'TABLE_UNCLASSIFIED' },
      { page: 5, reason: 'PROSE_ONLY' },
      { page: 6, reason: 'COVER_OR_INDEX' },
    ]);
  });

  it('rechecks only TABLE_UNCLASSIFIED pages', () => {
    expect(selectRecheckRanges([
      { page: 1, reason: 'COVER_OR_INDEX' },
      { page: 4, reason: 'TABLE_UNCLASSIFIED' },
      { page: 5, reason: 'PROSE_ONLY' },
      { page: 8, reason: 'TABLE_UNCLASSIFIED' },
      { page: 9, reason: 'BLANK' },
    ], 4)).toEqual([{ from: 4, to: 4 }, { from: 8, to: 8 }]);
  });
});
