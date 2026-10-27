/**
 * Workflow failure classification.
 *
 * Two separate audiences, and the test's job is to keep them separate:
 *
 *   - `message` / `errorCode` / `retryable` go on the WEBHOOK, which the
 *     integrating IDP reads to decide whether to re-submit a document. These are
 *     a live integration contract and must stay byte-identical to what the system
 *     already produces. The assertions below pin them.
 *
 *   - `detailedMessage` is stored in `operations.errorMessage` for operators.
 *     This is the only value that changes: storing the classified headline alone
 *     made every workflow failure read "internal error" in the Operations UI and
 *     the Profile Test panel, while the non-workflow engine stored the cause.
 */
import { classifyWorkflowFailure } from '@/lib/pipelines/workflow-engine';

describe('classifyWorkflowFailure — webhook contract is frozen', () => {
  it('input failure: INPUT_INVALID / retryable=false / unchanged headline', () => {
    const result = classifyWorkflowFailure('EXCEL_PARSE_FAILED: sheet "Luong" has no header row');

    expect(result.message).toBe('Workflow input could not be processed.');
    expect(result.errorCode).toBe('INPUT_INVALID');
    expect(result.retryable).toBe(false);
  });

  it.each([
    'INVALID_INPUT: Không nhận dạng được chứng từ nào trong bộ hồ sơ.',
    'INVALID_INPUT: Không bóc tách được dữ liệu từ bất kỳ chứng từ nào.',
    'INVALID_INPUT: Loan appraisal requires at least one document.',
  ])('loan-appraisal input failure "%s" is INPUT_INVALID / retryable=false', (raw) => {
    const result = classifyWorkflowFailure(raw);

    expect(result.errorCode).toBe('INPUT_INVALID');
    expect(result.retryable).toBe(false);
  });

  it('connector failure: CONNECTOR_ERROR / retryable=true / unchanged headline', () => {
    const result = classifyWorkflowFailure('Connection Error to ext-translator: fetch failed');

    expect(result.message).toBe('A downstream service could not complete the request.');
    expect(result.errorCode).toBe('CONNECTOR_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('workflow deadline: CONNECTOR_ERROR / retryable=true / time-budget headline', () => {
    const result = classifyWorkflowFailure('WORKFLOW_TIMEOUT: exceeded 7200000ms');

    expect(result.message).toContain('time budget');
    expect(result.errorCode).toBe('CONNECTOR_ERROR');
    expect(result.retryable).toBe(true);
    expect(result.detailedMessage).toContain('WORKFLOW_TIMEOUT: exceeded 7200000ms');
  });

  it('unclassified failure: SYSTEM_ERROR / retryable=true / unchanged headline', () => {
    const result = classifyWorkflowFailure("Cannot read properties of undefined (reading 'rows')");

    expect(result.message).toBe('Workflow processing failed due to an internal error.');
    expect(result.errorCode).toBe('SYSTEM_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('a provider 4xx stays a retryable CONNECTOR_ERROR — the retry decision is not re-litigated', () => {
    // A 403 caused by an invalid Model Override. Operationally this is a
    // configuration fault, but re-classifying it would flip `retryable` for the
    // live IDP integration, so it deliberately keeps the existing values.
    const raw = 'Connection Error to ext-doc-layout: External API returned HTTP 403: '
      + '{"error":{"message":"Model \\"gpt-9-ultra\\" is not available"}}';

    const result = classifyWorkflowFailure(raw);

    expect(result.message).toBe('A downstream service could not complete the request.');
    expect(result.errorCode).toBe('CONNECTOR_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('a provider 429 stays a retryable CONNECTOR_ERROR', () => {
    const raw = 'Connection Error to ext-data-extractor: External API returned HTTP 429: quota exceeded';

    const result = classifyWorkflowFailure(raw);

    expect(result.errorCode).toBe('CONNECTOR_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('never emits an error code outside the three values the integration knows', () => {
    const samples = [
      'EXCEL_EMPTY_DATA: no rows',
      'PDF_SPLIT_FAILED: encrypted',
      'INVALID_INPUT: missing field',
      'Connection Error to ext-qa-engine: External API returned HTTP 403: forbidden',
      'Connection Error to ext-qa-engine: External API returned HTTP 500: boom',
      'Connection Error to ext-qa-engine: External API timeout after 300s',
      'External API URL rejected: SSRF protection',
      'something entirely unexpected',
    ];

    for (const sample of samples) {
      const { errorCode, retryable } = classifyWorkflowFailure(sample);
      expect(['INPUT_INVALID', 'CONNECTOR_ERROR', 'SYSTEM_ERROR']).toContain(errorCode);
      expect(typeof retryable).toBe('boolean');
    }
  });
});

describe('classifyWorkflowFailure — detailedMessage carries the cause for operators', () => {
  it('appends the provider explanation for a connector failure', () => {
    const raw = 'Connection Error to ext-doc-layout: External API returned HTTP 403: '
      + '{"error":{"message":"Model \\"gpt-9-ultra\\" is not available"}}';

    const result = classifyWorkflowFailure(raw);

    expect(result.detailedMessage).toContain('gpt-9-ultra');
    expect(result.detailedMessage.startsWith(result.message)).toBe(true);
    // The short webhook headline stays free of provider detail.
    expect(result.message).not.toContain('gpt-9-ultra');
  });

  it('appends the cause for an input failure', () => {
    const result = classifyWorkflowFailure('EXCEL_PARSE_FAILED: sheet "Luong" has no header row');

    expect(result.detailedMessage).toContain('EXCEL_PARSE_FAILED');
  });

  it('appends the cause for an unclassified failure', () => {
    const result = classifyWorkflowFailure("Cannot read properties of undefined (reading 'rows')");

    expect(result.detailedMessage).toContain("reading 'rows'");
  });

  it('redacts credential-shaped values before they reach the stored message', () => {
    const raw = 'Connection Error to ext-qa-engine: External API returned HTTP 401: '
      + '{"api_key":"sk-live-SHOULD-NOT-LEAK","authorization":"Bearer eyJhbGciOiJIUzI1NiJ9"}';

    const result = classifyWorkflowFailure(raw);

    expect(result.detailedMessage).not.toContain('sk-live-SHOULD-NOT-LEAK');
    expect(result.detailedMessage).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result.detailedMessage).toContain('***');
  });
});
