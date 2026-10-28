// Pack HKD có tài sản bảo đảm (D-100). Stage 2 đọc hồ sơ 360 từ D-114.
import { financialInputsFromProfile } from '../financial-inputs';
import { HkdSecuredFinancialStrategy, PolicyStrategy, RecommendationStrategy } from '../strategies';
import type { SegmentPack } from './types';

export const HKD_SECURED_PACK: SegmentPack = {
  pack_id: 'hkd-secured',
  pack_version: '2.0.0',

  calculateFinancials: ({ profile, s3Available }) => new HkdSecuredFinancialStrategy().execute({
    // D-114: mọi đầu vào từ hồ sơ 360 (cùng số với màn hình Customer 360).
    inputs: financialInputsFromProfile(profile),
    // S3 lỗi ⇒ không biết tài sản nào là TSBĐ ⇒ không đánh giá (NOT_APPLICABLE) thay vì báo thiếu giả.
    skipCollateral: !s3Available,
  }),

  evaluatePolicy: ({ policy, checkSet, financial, promptResults }) => new PolicyStrategy(policy, checkSet).execute({
    facts: { financial },
    promptResults,
  }),

  recommend: ({ policy, financial, compliance }) => new RecommendationStrategy(policy).execute({ financial, policy: compliance }),
};
