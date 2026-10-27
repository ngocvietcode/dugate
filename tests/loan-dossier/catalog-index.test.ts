// T-CAT-02 — bộ nạp catalog dùng chung.
import { z } from 'zod';

import {
  docTypeByKey, enumValues, isReasonCode, loadDocTypes, loadEnums, loadLightExtraction, loadReasonCodes,
  loadSlFields, parseCatalogFile,
} from '@/lib/loan-dossier/catalog';

describe('catalog index (T-CAT-02)', () => {
  it('47 loại chứng từ: 27 cần bóc tách đầy đủ, 20 chỉ nhận diện', () => {
    const all = loadDocTypes();
    expect(all).toHaveLength(47);
    expect(all.filter((d) => d.needs_extraction)).toHaveLength(27);
    expect(all.filter((d) => !d.needs_extraction)).toHaveLength(20);
    expect(all.filter((d) => d.extraction_level === 'LIGHT')).toHaveLength(20);
  });

  it('D-70: summary_fields — 27 loại FULL có danh mục ≤ 5 key (loan_application ≤ 7), key thuộc từ vựng, LIGHT không có', () => {
    const vocab = new Set(enumValues('SummaryFieldKey'));
    expect(vocab.size).toBe(12);
    for (const d of loadDocTypes()) {
      if (d.extraction_level === 'LIGHT') {
        expect(d.summary_fields).toBeUndefined();
        continue;
      }
      const keys = d.summary_fields ?? [];
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(d.doc_type_key === 'loan_application' ? 7 : 5);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(vocab.has(k)).toBe(true);
    }
    expect(docTypeByKey('loan_application')?.summary_fields).toHaveLength(7);
    expect(docTypeByKey('id_card')?.summary_fields).toEqual(['full_name', 'id_number']);
  });

  it('docTypeByKey tra đúng, khóa lạ trả undefined', () => {
    expect(docTypeByKey('loan_application')?.needs_extraction).toBe(true);
    expect(docTypeByKey('household_business_license')?.extraction_level).toBe('LIGHT');
    expect(docTypeByKey('cccd')).toBeUndefined();
  });

  it('isReasonCode theo scope', () => {
    expect(isReasonCode('DOCUMENT_NOT_FOUND', 'CHK')).toBe(true);
    expect(isReasonCode('DOCUMENT_NOT_FOUND', 'STAGE')).toBe(false);
    expect(isReasonCode('COMPLETED')).toBe(true);
    expect(isReasonCode('NOT_A_CODE')).toBe(false);
    expect(loadReasonCodes().length).toBeGreaterThan(50);
  });

  it('enum đủ giá trị', () => {
    expect(loadEnums().SlCompareStatus).toHaveLength(6);
    expect(loadEnums().CheckRunStatus).toHaveLength(3);
    expect(enumValues('StageStatus')).not.toContain('PENDING');
    expect(() => enumValues('KhongCo')).toThrow(/KhongCo/);
  });

  it('sl_fields và light_extraction nạp được', () => {
    expect(loadSlFields().length).toBeGreaterThan(0);
    const light = loadLightExtraction();
    expect(light).toHaveLength(20);
    expect(light.find((d) => d.doc_type_key === 'household_business_license')?.fields.map((f) => f.key))
      .toEqual(['registration_number', 'business_name', 'business_address', 'business_line']);
  });

  it('file hỏng → lỗi nêu tên file và vị trí', () => {
    const schema = z.object({ version: z.string(), doc_types: z.array(z.object({ doc_type_key: z.string() })) });
    expect(() => parseCatalogFile('doc_types.json', { version: '3', doc_types: [{ doc_type_key: 1 }] }, schema))
      .toThrow(/doc_types\.json.*doc_types\.0\.doc_type_key/);
    expect(() => parseCatalogFile('enums.json', null, schema)).toThrow(/enums\.json/);
  });
});
