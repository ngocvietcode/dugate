import {
  canonicalExtractionResult,
  canonicalLogicResult,
  canonicalPipelineResults,
  summarizeOperationUsage,
  workflowChildVisibility,
} from '@/lib/operations/operational-metadata';
import { extractTokenUsage } from '@/lib/pipelines/processors/external-api';

describe('canonical operational metadata', () => {
  it.each([
    [true, 'PASS'],
    [false, 'FAIL'],
    ['PASS', 'PASS'],
    ['FAIL', 'FAIL'],
    [null, null],
    [undefined, null],
  ] as const)('maps logic outcome %p to %p', (outcome, expected) => {
    expect(canonicalLogicResult(outcome)).toBe(expected);
  });

  it.each([
    [true, 'SUCCESS'],
    [false, 'FAIL'],
    ['SUCCESS', 'SUCCESS'],
    ['FAIL', 'FAIL'],
    [null, null],
    [undefined, null],
  ] as const)('maps extraction outcome %p to %p', (outcome, expected) => {
    expect(canonicalExtractionResult(outcome)).toBe(expected);
  });

  it('only infers generic extraction results for explicit extraction endpoints', () => {
    expect(canonicalPipelineResults('extract:invoice', true)).toEqual({
      logicResult: null,
      extractionResult: 'SUCCESS',
    });
    expect(canonicalPipelineResults('extract:invoice', false).extractionResult).toBe('FAIL');
    expect(canonicalPipelineResults('analyze:fact-check', true)).toEqual({
      logicResult: null,
      extractionResult: null,
    });
  });

  it('distinguishes explicit zero usage from missing source measurements', () => {
    const zeroUsage = summarizeOperationUsage([{
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costSource: 'none',
    }]);
    expect(zeroUsage).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      inputTokensMissing: false,
      outputTokensMissing: false,
      costMissing: false,
      hasUnpricedCost: false,
    });

    const missingUsage = [{
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costSource: 'none' as const,
    }];
    expect(summarizeOperationUsage(missingUsage)).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      inputTokensMissing: true,
      outputTokensMissing: true,
      costMissing: true,
      hasUnpricedCost: false,
    });
    expect(missingUsage[0]).toEqual(expect.objectContaining({
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    }));
  });

  it('includes priced costs and excludes unpriced costs while retaining the warning', () => {
    expect(summarizeOperationUsage([
      { inputTokens: 10, outputTokens: 5, costUsd: 1.25, costSource: 'provider' },
      { inputTokens: 20, outputTokens: 10, costUsd: 9.99, costSource: 'unpriced' },
    ])).toEqual(expect.objectContaining({
      totalInputTokens: 30,
      totalOutputTokens: 15,
      totalCostUsd: 1.25,
      costMissing: false,
      hasUnpricedCost: true,
    }));
  });

  it('hides new workflow children without soft-deleting their source rows', () => {
    expect(workflowChildVisibility()).toEqual({
      hiddenFromOperations: true,
      deletedAt: null,
    });
  });
});

describe('usage source extraction', () => {
  it('preserves explicit provider zero values', () => {
    expect(extractTokenUsage({
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reportedCostUsd: null,
    });
  });

  it('preserves missing provider values as null', () => {
    expect(extractTokenUsage({})).toEqual({
      inputTokens: null,
      outputTokens: null,
      reportedCostUsd: null,
    });
  });
});
