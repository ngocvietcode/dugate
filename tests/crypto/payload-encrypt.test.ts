// tests/crypto/payload-encrypt.test.ts
//
// Unit tests for:
//   lib/crypto/payload-encrypt.ts        — encryptPayload / decryptPayload
//   lib/pipelines/workflows/payment-account-management/shared/webhook-transform.ts
//                                        — buildPamWebhookTransform
//
// Encryption scheme: AES-256-GCM + RSA-OAEP-SHA-256.
// RSA key pairs generated fresh per suite — no real keys used.

import crypto from 'crypto';
import { encryptPayload, decryptPayload } from '../../lib/crypto/payload-encrypt';
import { buildPamWebhookTransform } from '../../lib/pipelines/workflows/payment-account-management/shared/webhook-transform';
import type { WorkflowContext } from '../../lib/pipelines/workflow-engine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRsaKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function makeCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    operationId: 'op-test',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    pipelineVars: {},
    filesJson: null,
    filesData: [],
    stepsResult: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    usageBreakdown: [],
    webhookUrl: 'https://partner.example.com/callback',
    apiKeyId: null,
    createdByUserId: null,
    promptOverrides: {},
    modelOverrides: {},
    reasoningEffortOverrides: {},
    currentStep: 0,
    endpointSlug: 'workflows:payment-account-management',
    ...overrides,
  } as WorkflowContext;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const partner = generateRsaKeyPair();
const other   = generateRsaKeyPair();

const SAMPLE_PAYLOAD = {
  done: true,
  metadata: { state: 'SUCCEEDED', progress_percent: 100 },
  result: {
    extracted_data: {
      request_id: 'op-abc123',
      skill_code: 'payment-account-management',
      status: 'SUCCESS',
      metadata: { mode: 'open', stage: 'e2e' },
      result: {
        stage: 'e2e',
        documents: [
          {
            file_id: 'IDP-DOC-0001',
            name: 'cccd_mat_truoc.jpg',
            classification: { code: 'can_cuoc_cong_dan', confidence: 0.97 },
            extracted: {
              id_no:     { value: '079123456789', confidence: 0.99 },
              full_name: { value: 'NGUYEN VAN A',  confidence: 0.98 },
            },
          },
        ],
      },
    },
  },
};

const PLAINTEXT = JSON.stringify(SAMPLE_PAYLOAD);

// ─── encryptPayload / decryptPayload — round-trip ─────────────────────────────

describe('encryptPayload / decryptPayload — round-trip', () => {
  it('decrypts back to the original plaintext', () => {
    const enc = encryptPayload(PLAINTEXT, partner.publicKey);
    const dec = decryptPayload(enc.encryptedPayload, enc.nonce, enc.encKey, partner.privateKey);
    expect(dec).toBe(PLAINTEXT);
  });

  it('parsed decrypted JSON matches original payload object', () => {
    const enc = encryptPayload(PLAINTEXT, partner.publicKey);
    const dec = decryptPayload(enc.encryptedPayload, enc.nonce, enc.encKey, partner.privateKey);
    expect(JSON.parse(dec)).toEqual(SAMPLE_PAYLOAD);
  });

  it('handles empty string plaintext', () => {
    const enc = encryptPayload('', partner.publicKey);
    const dec = decryptPayload(enc.encryptedPayload, enc.nonce, enc.encKey, partner.privateKey);
    expect(dec).toBe('');
  });

  it('handles Unicode / Vietnamese characters correctly', () => {
    const vietnamese = JSON.stringify({ name: 'Nguyễn Văn A', address: 'Hà Nội' });
    const enc = encryptPayload(vietnamese, partner.publicKey);
    const dec = decryptPayload(enc.encryptedPayload, enc.nonce, enc.encKey, partner.privateKey);
    expect(dec).toBe(vietnamese);
  });
});

// ─── Output format ────────────────────────────────────────────────────────────

describe('encryptPayload — output format', () => {
  let enc: ReturnType<typeof encryptPayload>;
  beforeAll(() => { enc = encryptPayload(PLAINTEXT, partner.publicKey); });

  it('all three output fields are valid base64url (RFC 4648 §5)', () => {
    const isBase64url = (s: string) => /^[A-Za-z0-9_-]+=*$/.test(s);
    expect(isBase64url(enc.encryptedPayload)).toBe(true);
    expect(isBase64url(enc.nonce)).toBe(true);
    expect(isBase64url(enc.encKey)).toBe(true);
  });

  it('nonce is exactly 12 bytes', () => {
    expect(Buffer.from(enc.nonce, 'base64url').length).toBe(12);
  });

  it('encryptedPayload length = plaintext bytes + 16 bytes GCM tag', () => {
    const ctBytes = Buffer.from(enc.encryptedPayload, 'base64url');
    expect(ctBytes.length).toBe(Buffer.byteLength(PLAINTEXT, 'utf8') + 16);
  });
});

// ─── Freshness — no key/nonce reuse ──────────────────────────────────────────

describe('encryptPayload — freshness', () => {
  it('each call produces a different ciphertext', () => {
    const enc1 = encryptPayload(PLAINTEXT, partner.publicKey);
    const enc2 = encryptPayload(PLAINTEXT, partner.publicKey);
    expect(enc1.encryptedPayload).not.toBe(enc2.encryptedPayload);
  });

  it('each call produces a different nonce', () => {
    const enc1 = encryptPayload(PLAINTEXT, partner.publicKey);
    const enc2 = encryptPayload(PLAINTEXT, partner.publicKey);
    expect(enc1.nonce).not.toBe(enc2.nonce);
  });

  it('each call produces a different wrapped AES key (RSA-OAEP random padding)', () => {
    const enc1 = encryptPayload(PLAINTEXT, partner.publicKey);
    const enc2 = encryptPayload(PLAINTEXT, partner.publicKey);
    expect(enc1.encKey).not.toBe(enc2.encKey);
  });
});

// ─── Failure paths ────────────────────────────────────────────────────────────

describe('decryptPayload — failure paths', () => {
  let enc: ReturnType<typeof encryptPayload>;
  beforeEach(() => { enc = encryptPayload(PLAINTEXT, partner.publicKey); });

  it('throws when wrong private key is used', () => {
    expect(() =>
      decryptPayload(enc.encryptedPayload, enc.nonce, enc.encKey, other.privateKey),
    ).toThrow();
  });

  it('throws on tampered ciphertext — GCM auth tag failure', () => {
    const ctBytes = Buffer.from(enc.encryptedPayload, 'base64url');
    ctBytes[0] ^= 0x01;
    expect(() =>
      decryptPayload(ctBytes.toString('base64url'), enc.nonce, enc.encKey, partner.privateKey),
    ).toThrow();
  });

  it('throws on tampered auth tag (last 16 bytes)', () => {
    const ctBytes = Buffer.from(enc.encryptedPayload, 'base64url');
    ctBytes[ctBytes.length - 1] ^= 0xff;
    expect(() =>
      decryptPayload(ctBytes.toString('base64url'), enc.nonce, enc.encKey, partner.privateKey),
    ).toThrow();
  });

  it('throws on tampered wrapped key', () => {
    const keyBytes = Buffer.from(enc.encKey, 'base64url');
    keyBytes[0] ^= 0xff;
    expect(() =>
      decryptPayload(enc.encryptedPayload, enc.nonce, keyBytes.toString('base64url'), partner.privateKey),
    ).toThrow();
  });

  it('throws on wrong nonce', () => {
    const wrongNonce = Buffer.from(crypto.randomBytes(12)).toString('base64url');
    expect(() =>
      decryptPayload(enc.encryptedPayload, wrongNonce, enc.encKey, partner.privateKey),
    ).toThrow();
  });
});

// ─── Bad inputs ───────────────────────────────────────────────────────────────

describe('encryptPayload — bad public key inputs', () => {
  it('throws when public key is not a valid PEM', () => {
    expect(() => encryptPayload(PLAINTEXT, 'not-a-pem')).toThrow(/partner_public_key/);
  });

  it('throws when public key is empty string', () => {
    expect(() => encryptPayload(PLAINTEXT, '')).toThrow();
  });

  it('throws when public key is whitespace only', () => {
    expect(() => encryptPayload(PLAINTEXT, '   ')).toThrow();
  });
});

// ─── buildPamWebhookTransform — body-only format ──────────────────────────────

describe('buildPamWebhookTransform', () => {
  it('returns undefined when partner_public_key is not set', () => {
    const ctx = makeCtx({ pipelineVars: {} });
    expect(buildPamWebhookTransform(ctx)).toBeUndefined();
  });

  it('returns undefined when partner_public_key is empty string', () => {
    const ctx = makeCtx({ pipelineVars: { partner_public_key: '' } });
    expect(buildPamWebhookTransform(ctx)).toBeUndefined();
  });

  it('returns undefined when partner_public_key is whitespace only', () => {
    const ctx = makeCtx({ pipelineVars: { partner_public_key: '   ' } });
    expect(buildPamWebhookTransform(ctx)).toBeUndefined();
  });

  it('returns a function when partner_public_key is set', () => {
    const ctx = makeCtx({ pipelineVars: { partner_public_key: partner.publicKey } });
    expect(buildPamWebhookTransform(ctx)).toBeInstanceOf(Function);
  });

  describe('transform function output', () => {
    let transform: NonNullable<WorkflowContext['transformWebhookPayload']>;

    beforeAll(() => {
      const ctx = makeCtx({ pipelineVars: { partner_public_key: partner.publicKey } });
      transform = buildPamWebhookTransform(ctx)!;
    });

    it('body contains all four fields: encrypt_mode, nonce, encrypted_key, encrypted_payload', async () => {
      const { body } = await transform(SAMPLE_PAYLOAD);
      const parsed = JSON.parse(body);
      expect(parsed.encrypt_mode).toBe('full');
      expect(typeof parsed.nonce).toBe('string');
      expect(typeof parsed.encrypted_key).toBe('string');
      expect(typeof parsed.encrypted_payload).toBe('string');
    });

    it('headers are empty — all encryption metadata is in body', async () => {
      const { headers } = await transform(SAMPLE_PAYLOAD);
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('nonce in body is exactly 12 bytes', async () => {
      const { body } = await transform(SAMPLE_PAYLOAD);
      const { nonce } = JSON.parse(body);
      expect(Buffer.from(nonce, 'base64url').length).toBe(12);
    });

    it('decrypting body fields recovers the original payload', async () => {
      const { body } = await transform(SAMPLE_PAYLOAD);
      const { encrypted_payload, nonce, encrypted_key } = JSON.parse(body) as {
        encrypted_payload: string;
        nonce: string;
        encrypted_key: string;
      };
      const plaintext = decryptPayload(encrypted_payload, nonce, encrypted_key, partner.privateKey);
      expect(JSON.parse(plaintext)).toEqual(SAMPLE_PAYLOAD);
    });

    it('two calls produce different ciphertexts and nonces', async () => {
      const r1 = await transform(SAMPLE_PAYLOAD);
      const r2 = await transform(SAMPLE_PAYLOAD);
      const b1 = JSON.parse(r1.body);
      const b2 = JSON.parse(r2.body);
      expect(b1.encrypted_payload).not.toBe(b2.encrypted_payload);
      expect(b1.nonce).not.toBe(b2.nonce);
    });

    it('rejects when public key PEM is malformed', async () => {
      const ctx = makeCtx({
        pipelineVars: {
          partner_public_key: '-----BEGIN PUBLIC KEY-----\nINVALID\n-----END PUBLIC KEY-----',
        },
      });
      const badTransform = buildPamWebhookTransform(ctx)!;
      await expect(badTransform(SAMPLE_PAYLOAD)).rejects.toThrow();
    });
  });
});
