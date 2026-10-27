// T-S2-02 — schema zod dùng chung.
import {
  AddressSchema, AssetDescriptorSchema, DocumentPartySchema, EvidenceEnvelopeSchema, LegalInfoSchema,
  MoneyVNDSchema, NullableDateSchema,
} from '@/lib/loan-dossier/s2/common-schema';

import { makeAsset, makeEvidence, makeLegalInfo, makeParty } from './fixtures/build';

describe('common schema (T-S2-02)', () => {
  it('Party hợp lệ qua; thiếu party_role bị từ chối', () => {
    expect(DocumentPartySchema.safeParse(makeParty()).success).toBe(true);
    const { party_role: _omit, ...noRole } = makeParty();
    expect(DocumentPartySchema.safeParse(noRole).success).toBe(false);
  });

  it('party_role ngoài enum bị từ chối', () => {
    expect(DocumentPartySchema.safeParse(makeParty({ party_role: 'BOSS' })).success).toBe(false);
  });

  it('MoneyVND từ chối số thập phân và số âm', () => {
    expect(MoneyVNDSchema.safeParse(120000000).success).toBe(true);
    expect(MoneyVNDSchema.safeParse(1.5).success).toBe(false);
    expect(MoneyVNDSchema.safeParse(-1).success).toBe(false);
  });

  it('ngày 14/10/2026 bị từ chối, 2026-10-14 qua; ngày không tồn tại bị từ chối', () => {
    expect(NullableDateSchema.safeParse('2026-10-14').success).toBe(true);
    expect(NullableDateSchema.safeParse('2026-10').success).toBe(true);
    expect(NullableDateSchema.safeParse('14/10/2026').success).toBe(false);
    expect(NullableDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('field thừa bị từ chối (strict)', () => {
    expect(AddressSchema.safeParse({ ...makeParty().permanent_address, zip: '1' }).success).toBe(false);
    expect(LegalInfoSchema.safeParse({ ...makeLegalInfo(), extra: 1 }).success).toBe(false);
    expect(AssetDescriptorSchema.safeParse({ ...makeAsset(), extra: 1 }).success).toBe(false);
  });

  it('địa chỉ dạng chuỗi bị từ chối', () => {
    expect(DocumentPartySchema.safeParse({ ...makeParty(), permanent_address: 'SO 1 DUONG A' }).success).toBe(false);
  });

  it('envelope mẫu qua; ERROR phải có reason_code và data = null', () => {
    expect(EvidenceEnvelopeSchema.safeParse(makeEvidence('id_card')).success).toBe(true);
    const err = makeEvidence('id_card', { status: 'ERROR', data: null, reason_code: 'FORM_NOT_FOUND' });
    expect(EvidenceEnvelopeSchema.safeParse(err).success).toBe(true);
    expect(EvidenceEnvelopeSchema.safeParse({ ...err, reason_code: null }).success).toBe(false);
    expect(EvidenceEnvelopeSchema.safeParse({ ...err, data: {} }).success).toBe(false);
  });

  it('envelope: extraction_level phải khớp doc_types; evidence_id đúng mẫu; doc_type_key lạ bị từ chối', () => {
    expect(EvidenceEnvelopeSchema.safeParse(makeEvidence('id_card', { extraction_level: 'LIGHT' })).success).toBe(false);
    expect(EvidenceEnvelopeSchema.safeParse(makeEvidence('id_card', { evidence_id: 'ev-1-3' })).success).toBe(false);
    expect(EvidenceEnvelopeSchema.safeParse({ ...makeEvidence('id_card'), doc_type_key: 'cccd' }).success).toBe(false);
  });

  it('duplicate_group_id và duplicate_status đi cùng nhau', () => {
    expect(EvidenceEnvelopeSchema.safeParse(makeEvidence('id_card', { duplicate_group_id: 'dup-1', duplicate_status: null })).success).toBe(false);
    expect(EvidenceEnvelopeSchema.safeParse(makeEvidence('id_card', { duplicate_group_id: 'dup-1', duplicate_status: 'CONFIRMED_DUPLICATE' })).success).toBe(true);
  });
});
