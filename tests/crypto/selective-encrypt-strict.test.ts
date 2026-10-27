// [SEC 29/09 LA-S1] Strict selective encryption: a stale concrete path must fail
// closed instead of letting that field go out as plaintext while another path
// still matches.
import crypto from 'crypto';
import {
  encryptSelective,
  SelectiveEncryptionFieldError,
  SelectiveEncryptionPathError,
} from '@/lib/crypto/selective-encrypt';

// Key pair generated per run — no key material is committed (SECURITY-RULES §10).
const { publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const payload = {
  operation_id: 'op-1',
  extracted_data: {
    evaluation: {
      dossier: {
        ai_summary: { customer_360: { identity: { full_name: 'NGUYỄN VĂN A', id_number: null } } },
      },
    },
    extraction: {
      files: [{ file_name: 'cccd.pdf', documents: [{ fields: { personal_info: { full_name: 'NGUYỄN VĂN A' } } }] }],
    },
  },
};

describe('encryptSelective strictPaths', () => {
  it('rejects a stale concrete path even when another path matched', () => {
    const fields = ['extracted_data.customer_360.identity.full_name', '**.full_name'];
    // Legacy behaviour: the stale path is silently skipped.
    expect(() => encryptSelective(payload, fields, publicKey)).not.toThrow();
    // Strict: fail closed and name the stale path.
    try {
      encryptSelective(payload, fields, publicKey, { strictPaths: true });
      throw new Error('expected strict mode to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SelectiveEncryptionPathError);
      expect(error).toBeInstanceOf(SelectiveEncryptionFieldError);
      expect((error as SelectiveEncryptionPathError).configuredFields)
        .toEqual(['extracted_data.customer_360.identity.full_name']);
    }
  });

  it('accepts concrete paths that exist in the structure, including null leaves', () => {
    const fields = [
      'extracted_data.evaluation.dossier.ai_summary.customer_360.identity.full_name',
      'extracted_data.evaluation.dossier.ai_summary.customer_360.identity.id_number',
      'extracted_data.extraction.files[].documents[].fields.personal_info.full_name',
    ];
    const result = encryptSelective(payload, fields, publicKey, { strictPaths: true });
    const identity = (result.encryptedBody as any).extracted_data.evaluation.dossier.ai_summary.customer_360.identity;
    expect(identity.full_name).not.toBe('NGUYỄN VĂN A');
    expect(identity.id_number).toBeNull();
  });

  it('does not structurally check deep-wildcard paths', () => {
    expect(() => encryptSelective(payload, ['**.full_name', '**.not_present'], publicKey, { strictPaths: true }))
      .not.toThrow();
  });
});
