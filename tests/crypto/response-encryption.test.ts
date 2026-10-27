// tests/crypto/response-encryption.test.ts
//
// Tests for the unified response/webhook encryption layer:
//   lib/crypto/selective-encrypt.ts   — encryptSelective / decryptWithKey / wrapAesKey
//   lib/crypto/webhook-encryptor.ts    — encryptForWire (pam-legacy + spec styles)
//   lib/crypto/key-resolver.ts         — resolvePublicKey waterfall
//   lib/crypto/build-transform.ts      — buildEncryptTransform (Profile-driven)
//
// Scheme: AES-256-GCM + RSA-OAEP-SHA-256, URL-safe base64.
// RSA keys generated fresh per suite — no real keys.

import crypto from 'crypto';
import { encryptSelective, decryptWithKey, wrapAesKey, SelectiveEncryptionFieldError } from '../../lib/crypto/selective-encrypt';
import { encryptForWire } from '../../lib/crypto/webhook-encryptor';
import { resolvePublicKey } from '../../lib/crypto/key-resolver';
import { buildEncryptTransform } from '../../lib/crypto/build-transform';
import { decryptPayload } from '../../lib/crypto/payload-encrypt';

function rsaPair(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function unwrap(encKeyB64: string, privPem: string): Buffer {
  return crypto.privateDecrypt(
    { key: privPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encKeyB64, 'base64url'),
  );
}

const partner = rsaPair();

const SAMPLE = {
  operation_id: 'op-123',
  state: 'SUCCEEDED',
  done: true,
  extracted_data: {
    tong_so_tai_lieu: 2,
    danh_sach_tai_lieu: [
      {
        file_name: 'BBKQ_CDM.pdf',
        status: 'success',
        extracted_data: {
          loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ MÁY CDM',
          ma_may: 'CDM001',
          don_vi_tiep_quy: 'Chi nhánh Hà Nội',
          so_tien_chenh_lech: '5.410.000',
        },
      },
      {
        file_name: 'BBKQ_ATM.pdf',
        status: 'success',
        extracted_data: {
          loai_tai_lieu: 'BIÊN BẢN KIỂM QUỸ MÁY ATM',
          ma_may: 'ATM002',
          don_vi_tiep_quy: 'Chi nhánh HCM',
          so_tien_chenh_lech: '0',
        },
      },
    ],
  },
};

// ─── encryptSelective — dot-path + [] array notation ──────────────────────────

describe('encryptSelective — dot-path with [] notation', () => {
  it('encrypts a deep field inside every array element, shared key+nonce', () => {
    const paths = [
      'danh_sach_tai_lieu[].extracted_data.ma_may',
      'danh_sach_tai_lieu[].extracted_data.don_vi_tiep_quy',
    ];
    // Note: the array lives under extracted_data, so prefix accordingly:
    const payload = structuredClone(SAMPLE);
    const { encryptedBody, fields, nonce, encryptedKey } = encryptSelective(
      payload.extracted_data as Record<string, unknown>,
      paths,
      partner.publicKey,
    );

    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nonceBytes = Buffer.from(nonce, 'base64url');

    const list = (encryptedBody as any).danh_sach_tai_lieu;
    // ma_may + don_vi_tiep_quy encrypted; loai_tai_lieu untouched
    expect(list[0].extracted_data.loai_tai_lieu).toBe('BIÊN BẢN KIỂM QUỸ MÁY CDM');
    expect(list[0].extracted_data.ma_may).not.toBe('CDM001');
    expect(decryptWithKey(list[0].extracted_data.ma_may, aesKey, nonceBytes)).toBe('CDM001');
    expect(decryptWithKey(list[1].extracted_data.don_vi_tiep_quy, aesKey, nonceBytes)).toBe('Chi nhánh HCM');
    expect(fields).toEqual(paths);
  });

  it('encrypts a top-level object field (whole extracted_data)', () => {
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      structuredClone(SAMPLE) as Record<string, unknown>,
      ['extracted_data'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nonceBytes = Buffer.from(nonce, 'base64url');
    expect(typeof (encryptedBody as any).extracted_data).toBe('string');
    // envelope stays plaintext
    expect((encryptedBody as any).operation_id).toBe('op-123');
    const decrypted = JSON.parse(decryptWithKey((encryptedBody as any).extracted_data, aesKey, nonceBytes));
    expect(decrypted).toEqual(SAMPLE.extracted_data);
  });

  it('does not mutate the input payload', () => {
    const input = structuredClone(SAMPLE) as Record<string, unknown>;
    encryptSelective(input, ['extracted_data'], partner.publicKey);
    expect((input as any).extracted_data.tong_so_tai_lieu).toBe(2);
  });

  it('reports only fields that were present (missing path skipped)', () => {
    const { fields } = encryptSelective(
      structuredClone(SAMPLE) as Record<string, unknown>,
      ['extracted_data', 'does_not_exist'],
      partner.publicKey,
    );
    expect(fields).toEqual(['extracted_data']);
  });

  it('fails closed when NONE of the configured field paths match (no silent plaintext)', () => {
    expect(() =>
      encryptSelective(
        structuredClone(SAMPLE) as Record<string, unknown>,
        ['does_not_exist', 'also_missing'],
        partner.publicKey,
      ),
    ).toThrow(/no encrypted fields/i);
  });

  it('handles Vietnamese/Unicode values', () => {
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      { name: 'Nguyễn Văn A' },
      ['name'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const decrypted = decryptWithKey((encryptedBody as any).name, aesKey, Buffer.from(nonce, 'base64url'));
    expect(decrypted).toBe('Nguyễn Văn A');
  });
});

describe('wrapAesKey — validation', () => {
  it('throws on a non-PEM public key', () => {
    expect(() => wrapAesKey(crypto.randomBytes(32), 'nope')).toThrow(/encryption_public_key/);
  });
});

// ─── encryptSelective — deep wildcard `**` (encrypt a field everywhere) ───────

describe('encryptSelective — `**` deep wildcard', () => {
  // Mirrors the real poll response: the same business field (ma_may) appears in
  // result.extracted_data.danh_sach_tai_lieu[], in result.pipeline_steps[].extracted_data[],
  // AND in metadata.pipeline_steps[].extracted_data[]. One `**` rule must cover all.
  const buildResponse = () => ({
    name: 'operations/op-1',
    done: true,
    metadata: {
      state: 'SUCCEEDED',
      pipeline_steps: [
        {
          step: 0,
          processor: 'ext-data-extractor',
          extracted_data: [
            { file_name: 'A.pdf', status: 'success', extracted_data: { ma_may: 'A1158005', loai_may: 'CDM' } },
            { file_name: 'B.pdf', status: 'success', extracted_data: { ma_may: 'A0102005', loai_may: 'ATM' } },
          ],
        },
      ],
    },
    result: {
      output_format: 'json',
      extracted_data: {
        tong_so_tai_lieu: 2,
        danh_sach_tai_lieu: [
          { file_name: 'A.pdf', extracted_data: { ma_may: 'A1158005', loai_may: 'CDM' } },
          { file_name: 'B.pdf', extracted_data: { ma_may: 'A0102005', loai_may: 'ATM' } },
        ],
      },
      pipeline_steps: [
        {
          step: 0,
          processor: 'ext-data-extractor',
          extracted_data: [
            { file_name: 'A.pdf', status: 'success', extracted_data: { ma_may: 'A1158005', loai_may: 'CDM' } },
          ],
        },
      ],
    },
  });

  it('encrypts ma_may in EVERY location (result, result.pipeline_steps, metadata.pipeline_steps)', () => {
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      buildResponse() as Record<string, unknown>,
      ['**.ma_may'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nb = Buffer.from(nonce, 'base64url');
    const body = encryptedBody as any;

    // result.extracted_data.danh_sach_tai_lieu[]
    const list = body.result.extracted_data.danh_sach_tai_lieu;
    expect(list[0].extracted_data.ma_may).not.toBe('A1158005');
    expect(decryptWithKey(list[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');
    expect(list[0].extracted_data.loai_may).toBe('CDM'); // untouched
    expect(decryptWithKey(list[1].extracted_data.ma_may, aesKey, nb)).toBe('A0102005');

    // result.pipeline_steps[].extracted_data[]
    const rStep = body.result.pipeline_steps[0].extracted_data;
    expect(decryptWithKey(rStep[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');

    // metadata.pipeline_steps[].extracted_data[]
    const mStep = body.metadata.pipeline_steps[0].extracted_data;
    expect(decryptWithKey(mStep[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');
    expect(decryptWithKey(mStep[1].extracted_data.ma_may, aesKey, nb)).toBe('A0102005');
    expect(mStep[0].extracted_data.loai_may).toBe('CDM'); // untouched
  });

  it('does not double-encrypt: each ciphertext decrypts once to the original', () => {
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      buildResponse() as Record<string, unknown>,
      ['**.ma_may'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nb = Buffer.from(nonce, 'base64url');
    const val = (encryptedBody as any).result.extracted_data.danh_sach_tai_lieu[0].extracted_data.ma_may;
    // A single decrypt yields the plaintext (not another base64url ciphertext).
    expect(decryptWithKey(val, aesKey, nb)).toBe('A1158005');
  });

  it('supports a multi-segment tail after `**` (e.g. **.extracted_data.ma_may)', () => {
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      buildResponse() as Record<string, unknown>,
      ['**.extracted_data.ma_may'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nb = Buffer.from(nonce, 'base64url');
    const list = (encryptedBody as any).result.extracted_data.danh_sach_tai_lieu;
    expect(decryptWithKey(list[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');
    const mStep = (encryptedBody as any).metadata.pipeline_steps[0].extracted_data;
    expect(decryptWithKey(mStep[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');
  });

  it('still fails closed when `**` matches nothing', () => {
    expect(() =>
      encryptSelective(buildResponse() as Record<string, unknown>, ['**.does_not_exist'], partner.publicKey),
    ).toThrow(SelectiveEncryptionFieldError);
  });

  it('the SAME `**.ma_may` rule works for the webhook payload shape too (no result.* prefix)', () => {
    // Webhook payload differs from poll: business data sits under `extracted_data`
    // (no `result.` prefix). Because `**` matches by field name at any depth, one
    // rule covers both delivery shapes — poll and webhook — without per-path config.
    const webhookPayload = {
      operation_id: 'op-1',
      state: 'SUCCEEDED',
      done: true,
      extracted_data: {
        request_id: 'op-1',
        skill_code: 'tracing-portal',
        tong_so_tai_lieu: 2,
        danh_sach_tai_lieu: [
          { file_name: 'A.pdf', extracted_data: { ma_may: 'A1158005', loai_may: 'CDM' } },
          { file_name: 'B.pdf', extracted_data: { ma_may: 'A0102005', loai_may: 'ATM' } },
        ],
      },
    };
    const { encryptedBody, nonce, encryptedKey } = encryptSelective(
      webhookPayload as Record<string, unknown>,
      ['**.ma_may'],
      partner.publicKey,
    );
    const aesKey = unwrap(encryptedKey, partner.privateKey);
    const nb = Buffer.from(nonce, 'base64url');
    const list = (encryptedBody as any).extracted_data.danh_sach_tai_lieu;
    expect((encryptedBody as any).operation_id).toBe('op-1'); // envelope stays plaintext
    expect(decryptWithKey(list[0].extracted_data.ma_may, aesKey, nb)).toBe('A1158005');
    expect(decryptWithKey(list[1].extracted_data.ma_may, aesKey, nb)).toBe('A0102005');
    expect(list[0].extracted_data.loai_may).toBe('CDM'); // untouched
  });
});

// ─── encryptForWire — PAM legacy style (contract-frozen) ──────────────────────

describe('encryptForWire — pam-legacy style', () => {
  it('produces the exact PAM body shape and empty headers', () => {
    const { body, headers } = encryptForWire(SAMPLE, {
      style: 'pam-legacy',
      mode: 'full',
      publicKeyPem: partner.publicKey,
    });
    const parsed = JSON.parse(body);
    expect(parsed.encrypt_mode).toBe('full');
    expect(typeof parsed.nonce).toBe('string');
    expect(typeof parsed.encrypted_key).toBe('string');
    expect(typeof parsed.encrypted_payload).toBe('string');
    // no spec-style `encryption` object, no headers
    expect(parsed.encryption).toBeUndefined();
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it('round-trips back to the original payload', () => {
    const { body } = encryptForWire(SAMPLE, { style: 'pam-legacy', mode: 'full', publicKeyPem: partner.publicKey });
    const { encrypted_payload, nonce, encrypted_key } = JSON.parse(body);
    const plaintext = decryptPayload(encrypted_payload, nonce, encrypted_key, partner.privateKey);
    expect(JSON.parse(plaintext)).toEqual(SAMPLE);
  });
});

// ─── encryptForWire — spec style ──────────────────────────────────────────────

describe('encryptForWire — spec style / full mode', () => {
  it('body has encrypted_payload + encryption object; headers carry X-Encrypt-*', () => {
    const { body, headers } = encryptForWire(SAMPLE, {
      style: 'spec',
      mode: 'full',
      publicKeyPem: partner.publicKey,
      metadataTarget: 'both',
    });
    const parsed = JSON.parse(body);
    expect(typeof parsed.encrypted_payload).toBe('string');
    expect(parsed.encryption.mode).toBe('full');
    expect(headers['X-Encrypt-Mode']).toBe('full');
    expect(headers['X-Nonce']).toBe(parsed.encryption.nonce);
    expect(headers['X-Enc-Key']).toBe(parsed.encryption.encrypted_key);
  });

  it('metadata_target=headers omits the body encryption object', () => {
    const { body, headers } = encryptForWire(SAMPLE, {
      style: 'spec', mode: 'full', publicKeyPem: partner.publicKey, metadataTarget: 'headers',
    });
    expect(JSON.parse(body).encryption).toBeUndefined();
    expect(headers['X-Encrypt-Mode']).toBe('full');
  });

  it('metadata_target=body omits headers', () => {
    const { body, headers } = encryptForWire(SAMPLE, {
      style: 'spec', mode: 'full', publicKeyPem: partner.publicKey, metadataTarget: 'body',
    });
    expect(JSON.parse(body).encryption.mode).toBe('full');
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe('encryptForWire — spec style / selective mode', () => {
  it('keeps envelope plaintext, encrypts named field, headers list fields', () => {
    const { body, headers } = encryptForWire(SAMPLE, {
      style: 'spec',
      mode: 'selective',
      fields: ['extracted_data'],
      publicKeyPem: partner.publicKey,
      metadataTarget: 'both',
    });
    const parsed = JSON.parse(body);
    expect(parsed.operation_id).toBe('op-123'); // plaintext envelope
    expect(typeof parsed.extracted_data).toBe('string'); // encrypted
    expect(headers['X-Encrypt-Fields']).toBe('extracted_data');

    const aesKey = unwrap(parsed.encryption.encrypted_key, partner.privateKey);
    const nonceBytes = Buffer.from(parsed.encryption.nonce, 'base64url');
    expect(JSON.parse(decryptWithKey(parsed.extracted_data, aesKey, nonceBytes))).toEqual(SAMPLE.extracted_data);
  });
});

// ─── resolvePublicKey — waterfall ─────────────────────────────────────────────

describe('resolvePublicKey — key waterfall', () => {
  it('prefers encryption_public_key over partner_public_key', async () => {
    const key = await resolvePublicKey({
      encryption_public_key: 'SPEC_KEY',
      partner_public_key: 'PAM_KEY',
    });
    expect(key).toBe('SPEC_KEY');
  });

  it('falls back to partner_public_key (PAM legacy name)', async () => {
    const key = await resolvePublicKey({ partner_public_key: 'PAM_KEY' });
    expect(key).toBe('PAM_KEY');
  });

  it('falls back to Vault when no explicit key', async () => {
    const key = await resolvePublicKey(
      { encryption_vault_path: 'secret/partner' },
      async (p) => (p === 'secret/partner' ? 'VAULT_KEY' : null),
    );
    expect(key).toBe('VAULT_KEY');
  });

  it('returns null when nothing configured', async () => {
    expect(await resolvePublicKey({})).toBeNull();
  });

  it('skips Vault when fetcher not provided', async () => {
    expect(await resolvePublicKey({ encryption_vault_path: 'secret/x' })).toBeNull();
  });
});

// ─── buildEncryptTransform — Profile-driven wiring ────────────────────────────

describe('buildEncryptTransform', () => {
  it('returns undefined when encryption_enabled is not set (default off)', () => {
    expect(buildEncryptTransform({})).toBeUndefined();
    expect(buildEncryptTransform({ encryption_enabled: false })).toBeUndefined();
  });

  it('returns a transform when enabled (mode defaults to selective, fields supplied)', () => {
    expect(buildEncryptTransform({ encryption_enabled: true, encryption_mode: 'full', partner_public_key: partner.publicKey })).toBeInstanceOf(Function);
    expect(buildEncryptTransform({ encryption_enabled: 'true', encryption_mode: 'full', partner_public_key: partner.publicKey })).toBeInstanceOf(Function);
  });

  it('throws when selective (default) but encryption_fields is empty (no implicit field default)', () => {
    // mode omitted → defaults to selective → fields become mandatory.
    expect(() =>
      buildEncryptTransform({ encryption_enabled: true, encryption_public_key: partner.publicKey }),
    ).toThrow(/encryption_fields/);
    expect(() =>
      buildEncryptTransform({ encryption_enabled: true, encryption_mode: 'selective', encryption_public_key: partner.publicKey }),
    ).toThrow(/encryption_fields/);
  });

  it('encrypts the configured selective fields with both metadata targets', async () => {
    const t = buildEncryptTransform({
      encryption_enabled: true,
      encryption_mode: 'selective',
      encryption_fields: 'extracted_data',
      encryption_public_key: partner.publicKey,
    })!;
    const { body, headers } = await t(SAMPLE);
    const parsed = JSON.parse(body);
    expect(parsed.operation_id).toBe('op-123');
    expect(typeof parsed.extracted_data).toBe('string');
    expect(headers['X-Encrypt-Mode']).toBe('selective');
  });

  it('throws inside the transform when enabled but no key configured', async () => {
    const t = buildEncryptTransform({ encryption_enabled: true, encryption_mode: 'full' })!;
    await expect(t(SAMPLE)).rejects.toThrow(/no public key/);
  });

  it('honors full mode', async () => {
    const t = buildEncryptTransform({
      encryption_enabled: true,
      encryption_mode: 'full',
      encryption_public_key: partner.publicKey,
    })!;
    const { body } = await t(SAMPLE);
    expect(typeof JSON.parse(body).encrypted_payload).toBe('string');
  });
});
