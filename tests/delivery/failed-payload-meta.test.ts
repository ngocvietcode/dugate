import { describeSentBody } from '@/lib/delivery/failed-payload-meta';

describe('describeSentBody', () => {
  it('logs the full plaintext body when encryption is OFF', () => {
    const body = JSON.stringify({
      operation_id: 'op-123',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: { documents: [] },
    });

    const meta = describeSentBody(body, { last_error: 'HTTP 400' });

    expect(meta.encrypted).toBe(false);
    expect(meta.last_error).toBe('HTTP 400');
    expect(meta.body_bytes).toBe(Buffer.byteLength(body, 'utf8'));
    expect(meta.wire_keys).toEqual(['operation_id', 'state', 'done', 'extracted_data']);
    // full body is logged verbatim so the exact request can be compared to the spec
    expect(meta.sent_body).toBe(body);
  });

  it('logs the FULL-body wire shape with long ciphertext shortened to head…tail', () => {
    const cipher = 'aB3kf9' + 'Z'.repeat(600) + 'xZ2q';
    const wrapped = 'JOptbq' + 'K'.repeat(340) + '1lU';
    const body = JSON.stringify({
      encrypted_payload: cipher,
      encryption: { mode: 'full', fields: [], nonce: 'DeT-I2JYyjaz2w-e', encrypted_key: wrapped },
    });

    const meta = describeSentBody(body);

    expect(meta.encrypted).toBe(true);
    expect(meta.encryption_mode).toBe('full');
    expect(meta.encryption_fields).toEqual([]);
    expect(meta.wire_keys).toEqual(['encrypted_payload', 'encryption']);
    // body IS logged, but the long ciphertext/key are shortened to head…(len)…tail
    const sent = meta.sent_body as string;
    expect(sent).toContain('"encrypted_payload":"aB3kf9');
    expect(sent).toContain(`…(len=${cipher.length})…`);
    expect(sent).toContain(`…(len=${wrapped.length})…`);
    // the full ciphertext must NOT appear verbatim
    expect(sent).not.toContain(cipher);
    expect(sent.length).toBeLessThan(body.length);
    // short values (nonce, mode) stay intact
    expect(sent).toContain('"nonce":"DeT-I2JYyjaz2w-e"');
    expect(sent).toContain('"mode":"full"');
  });

  it('logs the full body + encrypted fields for SELECTIVE encryption', () => {
    const body = JSON.stringify({
      operation_id: 'op-456',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: { result: 'ciphertext_for_result_field' },
      encryption: {
        mode: 'selective',
        fields: ['extracted_data.result'],
        nonce: 'DeT-I2JYyjaz2w-e',
        encrypted_key: 'wrapped_key',
      },
    });

    const meta = describeSentBody(body);

    expect(meta.encrypted).toBe(true);
    expect(meta.encryption_mode).toBe('selective');
    expect(meta.encryption_fields).toEqual(['extracted_data.result']);
    // envelope is plaintext (operation_id/state visible); sensitive fields already ciphertext
    expect(meta.wire_keys).toContain('operation_id');
    expect(meta.wire_keys).toContain('encryption');
    expect(meta.sent_body).toBe(body);
  });

  it('shortens a long string value to head…(len)…tail instead of dumping it', () => {
    const huge = 'x'.repeat(5_000);
    const body = JSON.stringify({ operation_id: 'op', note: huge });

    const meta = describeSentBody(body);
    const sent = meta.sent_body as string;

    expect(typeof sent).toBe('string');
    expect(sent.length).toBeLessThan(body.length);
    expect(sent).toContain(`…(len=${huge.length})…`);
    expect(sent).not.toContain(huge);
    // short fields remain readable
    expect(sent).toContain('"operation_id":"op"');
  });

  it('handles a null/undefined body without throwing', () => {
    expect(describeSentBody(null)).toEqual({ sent_body: null, body_bytes: 0 });
    expect(describeSentBody(undefined, { last_error: 'x' }))
      .toEqual({ sent_body: null, body_bytes: 0, last_error: 'x' });
  });

  it('logs a non-JSON body raw rather than hiding it', () => {
    const meta = describeSentBody('not-json-at-all');
    expect(meta.encrypted).toBe(false);
    expect(meta.sent_body).toBe('not-json-at-all');
  });
});
