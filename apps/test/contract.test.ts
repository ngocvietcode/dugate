import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ReviewDecisionBody, RunEvent, StartRunRequest } from '../src/platform/contract';

const ok = {
  requestId: 'LOS-REQ-1',
  businessRef: { system: 'LOS', type: 'LOAN_APPLICATION', id: 'HS-1' },
  documents: [{ url: 'https://ecm.bank.local/doc/1' }],
  context: { product: 'pp-hkd-secured@0.1.0' },
  review: { makerUserId: 'rm01' },
};

describe('Workflow Service Contract', () => {
  it('nhận request hợp lệ, mặc định review DELEGATED', () => {
    const r = StartRunRequest.parse(ok);
    expect(r.review.mode).toBe('DELEGATED');
  });

  it('từ chối thiếu businessRef.id và URL sai', () => {
    const bad = { ...ok, businessRef: { system: 'LOS', type: 'X' }, documents: [{ url: 'not a url' }] };
    const r = StartRunRequest.safeParse(bad);
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['businessRef.id', 'documents.0.url']));
  });

  it('quyết định soát bắt buộc lý do', () => {
    expect(ReviewDecisionBody.safeParse({ action: 'CONFIRM', reason: '' }).success).toBe(false);
  });

  it('xuất được JSON Schema cho tài liệu tích hợp', () => {
    const js = z.toJSONSchema(StartRunRequest) as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toEqual(expect.arrayContaining(['requestId', 'businessRef', 'context', 'review']));
    expect(z.toJSONSchema(RunEvent)).toBeTruthy();
  });
});
