import { parseUsage } from '@/app/loan-appraisal-v2/lib/usage';

const usage = {
  input_tokens: 100, output_tokens: 50, pages_processed: 7, model_used: 'gpt', cost_usd: 0.25,
  breakdown: [{ processor: 'ocr', model: 'm', input_tokens: 1, output_tokens: 2, cost_usd: 0.1 }],
};

describe('parseUsage', () => {
  it('SUCCEEDED shows everything including pages and model', () => {
    const u = parseUsage({ metadata: { state: 'SUCCEEDED' }, result: { usage } });
    expect(u).toMatchObject({ inputTokens: 100, outputTokens: 50, pages: 7, model: 'gpt', costUsd: 0.25 });
    expect(u?.breakdown).toHaveLength(1);
  });

  it('FAILED hides pages and model', () => {
    const u = parseUsage({ metadata: { state: 'FAILED' }, result: { usage } });
    expect(u).toMatchObject({ inputTokens: 100, pages: null, model: null, costUsd: 0.25 });
  });

  it('CANCELLED or missing result hides the card', () => {
    expect(parseUsage({ metadata: { state: 'CANCELLED' }, result: { usage } })).toBeNull();
    expect(parseUsage({ metadata: { state: 'SUCCEEDED' } })).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage({ metadata: { state: 'SUCCEEDED' }, result: { usage: {} } })).toBeNull();
  });

  it('does not invent zeros for absent fields', () => {
    const u = parseUsage({ metadata: { state: 'SUCCEEDED' }, result: { usage: { cost_usd: 1 } } });
    expect(u?.inputTokens).toBeNull();
    expect(u?.pages).toBeNull();
  });
});
