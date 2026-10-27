import {
  buildCallbackPayload,
  type BuildCallbackPayloadInput,
  type WorkflowFailurePayload,
} from '@/lib/delivery/build-payload';

const core = (overrides: Partial<BuildCallbackPayloadInput> = {}): BuildCallbackPayloadInput => ({
  mode: null,
  engine: 'core',
  operationId: 'op-core-1',
  state: 'SUCCEEDED',
  extractedData: { invoice_no: 'INV-01' },
  outputContent: '{"invoice_no":"INV-01"}',
  ...overrides,
});

const workflow = (overrides: Partial<BuildCallbackPayloadInput> = {}): BuildCallbackPayloadInput => ({
  mode: null,
  engine: 'workflow',
  operationId: 'op-workflow-1',
  state: 'SUCCEEDED',
  endpointSlug: 'workflows:payroll-verify',
  extractedData: { decision: 'APPROVED' },
  ...overrides,
});

const classifiedFailure = (): WorkflowFailurePayload => ({
  message: 'A downstream service could not complete the request.',
  detailedMessage: 'A downstream service could not complete the request. — Connection Error',
  errorCode: 'CONNECTOR_ERROR',
  retryable: true,
});

describe('buildCallbackPayload legacy (NULL) contract', () => {
  it('keeps Core success and failed JSON byte-for-byte, including the missing failed done field', () => {
    expect(JSON.stringify(buildCallbackPayload(core()))).toBe(
      '{"operation_id":"op-core-1","state":"SUCCEEDED","done":true}',
    );
    expect(JSON.stringify(buildCallbackPayload(core({
      state: 'FAILED', errorMessage: 'pipeline exploded', errorCode: 'PIPELINE_ERROR',
    })))).toBe(
      '{"operation_id":"op-core-1","state":"FAILED","error":"pipeline exploded"}',
    );
  });

  it('keeps workflow success, failure, payroll detail, and PAUSED JSON byte-for-byte', () => {
    expect(JSON.stringify(buildCallbackPayload(workflow()))).toBe(
      '{"operation_id":"op-workflow-1","state":"SUCCEEDED","done":true,"extracted_data":{"decision":"APPROVED"}}',
    );
    expect(JSON.stringify(buildCallbackPayload(workflow({
      state: 'FAILED', workflowFailure: classifiedFailure(),
    })))).toBe(
      '{"operation_id":"op-workflow-1","state":"FAILED","done":true,"error":"A downstream service could not complete the request. — Connection Error","error_code":"CONNECTOR_ERROR","retryable":true}',
    );
    expect(JSON.stringify(buildCallbackPayload(workflow({
      state: 'FAILED', endpointSlug: 'workflows:lc-checker', workflowFailure: classifiedFailure(),
    })))).toBe(
      '{"operation_id":"op-workflow-1","state":"FAILED","done":true,"error":"A downstream service could not complete the request.","error_code":"CONNECTOR_ERROR","retryable":true}',
    );
    expect(JSON.stringify(buildCallbackPayload(workflow({ state: 'PAUSED', errorMessage: 'Waiting for input' })))).toBe(
      '{"operation_id":"op-workflow-1","state":"PAUSED","done":false,"error":"Waiting for input"}',
    );
  });
});

describe('buildCallbackPayload WITH_RESULT Core opt-in', () => {
  it('adds extracted_data and output_content without the overloaded result field', () => {
    const payload = buildCallbackPayload(core({ mode: 'WITH_RESULT' }));

    expect(payload).toEqual({
      operation_id: 'op-core-1',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: { invoice_no: 'INV-01' },
      output_content: '{"invoice_no":"INV-01"}',
    });
    expect(payload).not.toHaveProperty('result');
  });

  it.each([
    ['PIPELINE_INVALID_JSON', false],
    ['FILE_URL_DOWNLOAD_FAILED', true],
    ['PIPELINE_ERROR', true],
    [null, true],
    ['UNRECOGNIZED_ERROR', true],
  ] as const)('maps %s retryability and scrubs callback errors', (errorCode, retryable) => {
    const payload = buildCallbackPayload(core({
      mode: 'WITH_RESULT',
      state: 'FAILED',
      errorCode,
      errorMessage: 'provider rejected api_key=sk-live-DO-NOT-LEAK Authorization: Bearer abcdefghijklmnop',
    }));

    expect(payload).toMatchObject({
      operation_id: 'op-core-1',
      state: 'FAILED',
      done: true,
      error_code: errorCode,
      retryable,
    });
    expect(payload.error).not.toContain('sk-live-DO-NOT-LEAK');
    expect(payload.error).not.toContain('abcdefghijklmnop');
    expect(payload.error).toContain('***');
  });

  it('keeps the existing workflow classification contract when its mode is WITH_RESULT', () => {
    expect(buildCallbackPayload(workflow({
      mode: 'WITH_RESULT',
      state: 'FAILED',
      endpointSlug: 'workflows:lc-checker',
      workflowFailure: classifiedFailure(),
    }))).toEqual({
      operation_id: 'op-workflow-1',
      state: 'FAILED',
      done: true,
      error: 'A downstream service could not complete the request.',
      error_code: 'CONNECTOR_ERROR',
      retryable: true,
    });
  });
});
