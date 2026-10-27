// Pack HKD có tài sản bảo đảm: đóng gói nguyên văn logic stage 2–4 đang chạy (D-100), không đổi hành vi.
import { financialInputsV3 } from '../financial-inputs';
import { HkdSecuredFinancialStrategy, PolicyStrategy, RecommendationStrategy } from '../strategies';
import type { SegmentPack } from './types';

export const HKD_SECURED_PACK: SegmentPack = {
  pack_id: 'hkd-secured',
  pack_version: '1.0.0',

  calculateFinancials: ({ evidences, s3 }) => new HkdSecuredFinancialStrategy().execute({
    // V2-R06: đọc field có cấu trúc của spec-v3. Giá trị TSBĐ lấy theo tài sản `collateral` của S3; bản bị thay thế bị loại.
    inputs: financialInputsV3(evidences, s3),
    // S3 lỗi ⇒ không biết tài sản nào là TSBĐ ⇒ không đánh giá (NOT_APPLICABLE) thay vì báo thiếu giả.
    skipCollateral: s3 === null,
  }),

  evaluatePolicy: ({ policy, checkSet, financial, promptResults }) => new PolicyStrategy(policy, checkSet).execute({
    facts: { financial },
    promptResults,
  }),

  recommend: ({ policy, financial, compliance }) => new RecommendationStrategy(policy).execute({ financial, policy: compliance }),
};
