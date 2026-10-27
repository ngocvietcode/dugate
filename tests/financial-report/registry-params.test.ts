import { SERVICE_REGISTRY } from '@/lib/endpoints/registry';
import { resolveConfig } from '@/lib/pipelines/workflows/financial-report-translation';

const parameters = SERVICE_REGISTRY.workflows.subCases['financial-report-translation'].parameters;

describe('financial-report-translation Profile parameters — Round 14.5 P7–P9', () => {
  it('removes legacy callback credentials and request-only targetLang from this workflow registry', () => {
    for (const key of ['targetLang', 'csp_token_url', 'csp_client_id', 'csp_client_secret', 'ibm_client_id']) {
      expect(parameters).not.toHaveProperty(key);
    }
  });

  it('shows exactly the eight supported default Profile parameters', () => {
    const defaultVisible = Object.entries(parameters)
      .filter(([, schema]) => !schema.hidden)
      .map(([key]) => key);

    expect(defaultVisible).toEqual([
      'target_lang',
      'pages_per_chunk',
      'classify_pages_per_call',
      'workflow_deadline_ms',
      'max_concurrency',
      'stagger_delay_ms',
      'output_suppressed_report_types',
      'enable_translation',
    ]);
    expect(parameters.workflow_deadline_ms.description).toContain('Phải < 9000000');
  });

  it('keeps request targetLang precedence while target_lang remains the Profile fallback', () => {
    const ctx = (pipelineVars: Record<string, unknown>) => ({ operationId: 'target-lang', pipelineVars }) as never;

    expect(resolveConfig(ctx({ targetLang: 'en', target_lang: 'vi' })).targetLang).toBe('en');
    expect(resolveConfig(ctx({ target_lang: 'en' })).targetLang).toBe('en');
  });
});
