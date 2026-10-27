import { assertWorkflowWithinDeadline, isWorkflowTimeoutError, parseOutputSuppressedReportTypes } from '@/lib/pipelines/workflows/financial-report-translation';

describe('financial report workflow deadline — R14-R1', () => {
  it('throws the exact parent workflow timeout contract at the deadline', () => {
    expect(() => assertWorkflowWithinDeadline(100, 7_200_000, 7_200_100)).toThrow('WORKFLOW_TIMEOUT: exceeded 7200000ms');
    try {
      assertWorkflowWithinDeadline(100, 7_200_000, 7_200_100);
    } catch (error) {
      expect(isWorkflowTimeoutError(error)).toBe(true);
    }
  });
});

describe('output suppression configuration — R14-C2', () => {
  it('keeps CI suppressed when unset, exposes it when blank, and accepts only known report types', () => {
    expect(parseOutputSuppressedReportTypes(undefined)).toEqual(new Set(['comprehensiveIncome']));
    expect(parseOutputSuppressedReportTypes('')).toEqual(new Set());
    expect(parseOutputSuppressedReportTypes('comprehensiveIncome,balanceSheet,notAReport')).toEqual(
      new Set(['comprehensiveIncome', 'balanceSheet']),
    );
  });
});
