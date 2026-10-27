// T-TEST-01 — bộ dựng fixture giả.
import { loadDocTypes } from '@/lib/loan-dossier/catalog';
import {
  AssetDescriptorSchema, DocumentPartySchema, EvidenceEnvelopeSchema, LegalInfoSchema,
} from '@/lib/loan-dossier/s2/common-schema';

import { makeEvidence, makePdf, makePng } from './fixtures/build';

describe('fixtures/build (T-TEST-01)', () => {
  const all = loadDocTypes();

  it.each(all.map((d) => d.doc_type_key))('makeEvidence(%s): envelope và khối dùng chung parse qua zod', (key) => {
    const ev = makeEvidence(key);
    expect(EvidenceEnvelopeSchema.safeParse(ev).success).toBe(true);
    const data = ev.data as Record<string, unknown>;
    for (const p of (data.parties ?? []) as unknown[]) expect(DocumentPartySchema.safeParse(p).success).toBe(true);
    for (const a of (data.assets ?? []) as unknown[]) expect(AssetDescriptorSchema.safeParse(a).success).toBe(true);
    if (data.legal_info) expect(LegalInfoSchema.safeParse(data.legal_info).success).toBe(true);
  });

  it('loại có parties bắt buộc thì fixture có ≥ 1 party', () => {
    expect((makeEvidence('loan_application').data as { parties: unknown[] }).parties.length).toBeGreaterThanOrEqual(1);
    expect((makeEvidence('land_use_certificate').data as { assets: unknown[] }).assets.length).toBe(1);
    expect((makeEvidence('income_statement').data as { parties: Array<{ party_role: string }> }).parties[0].party_role).toBe('BORROWER');
  });

  it('LIGHT: party chủ thể đúng vai trò, fields đúng key', () => {
    const data = makeEvidence('household_business_license').data as { parties: Array<{ party_role: string }>; fields: object };
    expect(data.parties[0].party_role).toBe('HOLDER');
    expect(Object.keys(data.fields)).toEqual(['registration_number', 'business_name', 'business_address', 'business_line']);
  });

  it('makePng có magic 89 50 4E 47; makePdf(2) bắt đầu %PDF- và có 2 trang', () => {
    expect([...makePng(2, 3).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const pdf = makePdf(2).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('/Count 2');
  });

  it('không giá trị nào khớp mẫu số định danh thật', () => {
    const text = JSON.stringify(all.map((d) => makeEvidence(d.doc_type_key)));
    const ids = text.match(/(?<!\d)\d{9}(?:\d{3})?(?!\d)/g) ?? [];
    expect(ids.filter((s) => !/^0+$/.test(s))).toEqual([]);
  });
});
