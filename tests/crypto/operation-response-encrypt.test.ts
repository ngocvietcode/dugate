// tests/crypto/operation-response-encrypt.test.ts
//
// Tests encryptOperationResponse — reads encryption_* config from an operation's
// pipelineJson and encrypts the formatted poll/download response. Verifies the
// disabled-by-default behaviour (zero breaking change) and the enabled paths.

import crypto from 'crypto';
import { encryptOperationResponse } from '../../lib/crypto/operation-response-encrypt';
import { decryptWithKey, SelectiveEncryptionFieldError } from '../../lib/crypto/selective-encrypt';
import { decryptPayload } from '../../lib/crypto/payload-encrypt';

function rsaPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const partner = rsaPair();

function opWithVars(vars: Record<string, unknown> | null) {
  return {
    pipelineJson: vars ? JSON.stringify([{ variables: vars }]) : null,
  };
}

const FORMATTED = {
  name: 'operations/op-1',
  done: true,
  result: {
    content: 'output',
    extracted_data: { customer: 'Nguyễn Văn A', so_tien: '5.410.000' },
  },
};

describe('encryptOperationResponse — disabled (default)', () => {
  it('returns body unchanged when pipelineJson has no encryption config', async () => {
    const res = await encryptOperationResponse(structuredClone(FORMATTED), opWithVars({}));
    expect(res.encrypted).toBe(false);
    expect(res.body).toEqual(FORMATTED);
    expect(res.headers).toEqual({});
  });

  it('returns body unchanged when pipelineJson is null', async () => {
    const res = await encryptOperationResponse(structuredClone(FORMATTED), opWithVars(null));
    expect(res.encrypted).toBe(false);
    expect(res.body).toEqual(FORMATTED);
  });

  it('returns unchanged when encryption_enabled is false', async () => {
    const res = await encryptOperationResponse(
      structuredClone(FORMATTED),
      opWithVars({ encryption_enabled: false, encryption_public_key: partner.publicKey }),
    );
    expect(res.encrypted).toBe(false);
  });

  it('does NOT encrypt a still-running poll (done=false, no result yet) — returns plaintext status', async () => {
    // A poll while RUNNING returns only name/done/metadata (no `result`), so
    // selective field-paths would match nothing. Progress responses carry no
    // business data, so they must pass through as plaintext instead of failing.
    const running = {
      pipelineJson: JSON.stringify([{ variables: {
        encryption_enabled: true,
        encryption_mode: 'selective',
        encryption_fields: 'result.extracted_data.danh_sach_tai_lieu[].extracted_data.ma_may',
        encryption_public_key: partner.publicKey,
      } }]),
      done: false,
      state: 'RUNNING',
    };
    const res = await encryptOperationResponse(
      { name: 'operations/op-1', done: false, metadata: { state: 'RUNNING' } },
      running,
    );
    expect(res.encrypted).toBe(false);
  });

  it('encrypts once the operation has SUCCEEDED (done=true, result present)', async () => {
    const succeeded = {
      pipelineJson: JSON.stringify([{ variables: {
        encryption_enabled: true,
        encryption_mode: 'selective',
        encryption_fields: 'result.extracted_data',
        encryption_public_key: partner.publicKey,
      } }]),
      done: true,
      state: 'SUCCEEDED',
    };
    const res = await encryptOperationResponse(structuredClone(FORMATTED), succeeded);
    expect(res.encrypted).toBe(true);
    expect(typeof (res.body as any).result.extracted_data).toBe('string');
  });
});

describe('encryptOperationResponse — enabled', () => {
  it('selective mode encrypts the configured nested field, envelope stays plaintext', async () => {
    const res = await encryptOperationResponse(
      structuredClone(FORMATTED),
      opWithVars({
        encryption_enabled: true,
        encryption_mode: 'selective',
        encryption_fields: 'result.extracted_data',
        encryption_public_key: partner.publicKey,
      }),
    );
    expect(res.encrypted).toBe(true);
    expect((res.body as any).name).toBe('operations/op-1'); // plaintext
    expect(typeof (res.body as any).result.extracted_data).toBe('string'); // encrypted
    expect(res.headers['X-Encrypt-Mode']).toBe('selective');

    const encryption = (res.body as any).encryption;
    const aesKey = crypto.privateDecrypt(
      { key: partner.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encryption.encrypted_key, 'base64url'),
    );
    const decrypted = JSON.parse(
      decryptWithKey((res.body as any).result.extracted_data, aesKey, Buffer.from(encryption.nonce, 'base64url')),
    );
    expect(decrypted).toEqual(FORMATTED.result.extracted_data);
  });

  it('forceMode=full wraps the whole object (download path)', async () => {
    const res = await encryptOperationResponse(
      { content: 'markdown output', output_format: 'md' },
      opWithVars({ encryption_enabled: true, encryption_mode: 'selective', encryption_public_key: partner.publicKey }),
      undefined,
      'full',
    );
    expect(res.encrypted).toBe(true);
    const enc = (res.body as any).encryption;
    const plaintext = decryptPayload((res.body as any).encrypted_payload, enc.nonce, enc.encrypted_key, partner.privateKey);
    expect(JSON.parse(plaintext)).toEqual({ content: 'markdown output', output_format: 'md' });
  });

  it('throws when selective (default) but encryption_fields is empty', async () => {
    // mode omitted → defaults to selective → fields become mandatory.
    await expect(
      encryptOperationResponse(structuredClone(FORMATTED), opWithVars({ encryption_enabled: true, encryption_public_key: partner.publicKey })),
    ).rejects.toThrow(/encryption_fields/);
  });

  it('throws when enabled with full mode but no key configured', async () => {
    await expect(
      encryptOperationResponse(structuredClone(FORMATTED), opWithVars({ encryption_enabled: true, encryption_mode: 'full' })),
    ).rejects.toThrow(/no public key/);
  });

  it('resolves key from Vault fetcher when no explicit key', async () => {
    const res = await encryptOperationResponse(
      structuredClone(FORMATTED),
      opWithVars({ encryption_enabled: true, encryption_mode: 'selective', encryption_vault_path: 'secret/p', encryption_fields: 'result.extracted_data' }),
      async () => partner.publicKey,
    );
    expect(res.encrypted).toBe(true);
  });

  it('throws a typed SelectiveEncryptionFieldError when no field path matches (→ mapped to 422 by routes)', async () => {
    // A wrong dot-path (missing the "result." prefix that the poll response uses)
    // must fail closed with a TYPED error carrying the payload's top-level keys, so
    // the route can answer 422 + a corrective hint instead of a generic 500.
    expect.assertions(3);
    try {
      await encryptOperationResponse(
        structuredClone(FORMATTED),
        opWithVars({
          encryption_enabled: true,
          encryption_mode: 'selective',
          encryption_fields: 'extracted_data.customer', // wrong: real path is result.extracted_data.customer
          encryption_public_key: partner.publicKey,
        }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(SelectiveEncryptionFieldError);
      const typed = err as SelectiveEncryptionFieldError;
      expect(typed.configuredFields).toEqual(['extracted_data.customer']);
      // Top-level keys of the formatted poll response (name/done/result...).
      expect(typed.availableTopLevelKeys).toEqual(expect.arrayContaining(['name', 'done', 'result']));
    }
  });
});
