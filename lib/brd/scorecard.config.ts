// lib/brd/scorecard.config.ts
// Phần 1 — Prioritization Scorecard (AI Usecase Prioritization).
// Final Score = (BusinessValue*0.6 + TechnicalEffort*0.3 + Reusability*0.1) + Bonus
//   - B/T/R: thang 1–5 ; Bonus: 1–5 (cộng thẳng) ; Final Score: 2.0 → 10.0
// Technical Effort: ĐIỂM CAO = KHẢ THI CAO / NỖ LỰC THẤP (đặt technicalEffortInverse=true để đảo).

export type CriterionKey = 'businessValue' | 'technicalEffort' | 'reusability' | 'bonus';

export interface RubricLevel {
  score: 1 | 2 | 3 | 4 | 5;
  label: string;
  description: string;
}

export interface CriterionConfig {
  key: CriterionKey;
  label: string;
  weight: number;
  description: string;
  rubric: RubricLevel[];
}

export interface PriorityThreshold {
  min: number;
  priority: 'High' | 'Medium' | 'Low';
  action: string;
  color: string;
}

export interface ScorecardConfig {
  technicalEffortInverse: boolean;
  criteria: Record<CriterionKey, CriterionConfig>;
  thresholds: PriorityThreshold[];
}

function rubric(items: Array<[1 | 2 | 3 | 4 | 5, string, string]>): RubricLevel[] {
  return items.map(([score, label, description]) => ({ score, label, description }));
}

export const SCORECARD_CONFIG: ScorecardConfig = {
  technicalEffortInverse: false,

  criteria: {
    businessValue: {
      key: 'businessValue',
      label: 'Business Value',
      weight: 0.6,
      description:
        'Giá trị kinh doanh tổng hợp: Financial Impact, Cost Saving, Operation Efficiency, User/Customer Impact, Regulatory/Risk Compliance.',
      rubric: rubric([
        [1, 'Rất thấp', 'Gần như không có tác động tài chính/vận hành; phạm vi nhỏ, không liên quan compliance.'],
        [2, 'Thấp', 'Tác động hạn chế: tiết kiệm chi phí nhỏ hoặc cải thiện cục bộ một nhóm nhỏ người dùng.'],
        [3, 'Trung bình', 'Có lợi ích đo lường được (chi phí/FTE) hoặc ảnh hưởng tới <500k khách hàng.'],
        [4, 'Cao', 'Lợi ích tài chính/vận hành rõ rệt hoặc ảnh hưởng 500k–1tr KH; liên quan compliance.'],
        [5, 'Rất cao', 'Tác động tài chính lớn, ảnh hưởng >1tr KH, hoặc bắt buộc theo quy định/audit.'],
      ]),
    },
    technicalEffort: {
      key: 'technicalEffort',
      label: 'Technical Effort',
      weight: 0.3,
      description: 'Mức độ khả thi triển khai. Điểm cao = khả thi cao / nỗ lực thấp (dữ liệu sẵn sàng, tích hợp đơn giản).',
      rubric: rubric([
        [1, 'Rất khó', 'Nỗ lực rất lớn: dữ liệu chưa sẵn sàng, phụ thuộc nhiều hệ thống, rủi ro kỹ thuật cao.'],
        [2, 'Khó', 'Cần nhiều công sức tích hợp/chuẩn hóa dữ liệu; phụ thuộc một vài hệ thống.'],
        [3, 'Trung bình', 'Khối lượng vừa phải, công nghệ đã quen thuộc, dữ liệu phần lớn sẵn sàng.'],
        [4, 'Dễ', 'Tích hợp khá đơn giản, dữ liệu sẵn sàng, ít phụ thuộc.'],
        [5, 'Rất dễ', 'Triển khai nhanh, tận dụng thành phần có sẵn, gần như không rủi ro kỹ thuật.'],
      ]),
    },
    reusability: {
      key: 'reusability',
      label: 'Reusability',
      weight: 0.1,
      description: 'Khả năng tái sử dụng usecase/giải pháp cho nhiều BU, quy trình hoặc hệ thống khác.',
      rubric: rubric([
        [1, 'Rất thấp', 'Chỉ dùng cho một tình huống đơn lẻ, khó nhân rộng.'],
        [2, 'Thấp', 'Có thể tái dùng giới hạn trong cùng một quy trình.'],
        [3, 'Trung bình', 'Tái dùng được cho một vài quy trình tương tự.'],
        [4, 'Cao', 'Tái dùng tốt cho nhiều BU/quy trình với chỉnh sửa nhỏ.'],
        [5, 'Rất cao', 'Thành phần dùng chung (platform/skill) áp dụng rộng cho toàn portfolio.'],
      ]),
    },
    bonus: {
      key: 'bonus',
      label: 'Bonus (Mức độ chỉ đạo)',
      weight: 1,
      description: 'Điểm cộng theo mức độ chỉ đạo/định hướng từ lãnh đạo (1–5).',
      rubric: rubric([
        [1, 'Không có', 'Không có chỉ đạo cụ thể.'],
        [2, 'Khuyến khích', 'Được khuyến khích triển khai.'],
        [3, 'Định hướng', 'Nằm trong định hướng chung của đơn vị.'],
        [4, 'Ưu tiên', 'Lãnh đạo nêu rõ là ưu tiên.'],
        [5, 'Chỉ đạo trực tiếp', 'Chỉ đạo trực tiếp từ Ban lãnh đạo, bắt buộc triển khai.'],
      ]),
    },
  },

  thresholds: [
    { min: 7, priority: 'High', action: 'Triển khai ngay (Now)', color: '#16a34a' },
    { min: 5, priority: 'Medium', action: 'Đưa vào backlog có kế hoạch (Next)', color: '#d97706' },
    { min: 0, priority: 'Low', action: 'Trì hoãn / Xem xét lại (Later)', color: '#dc2626' },
  ],
};
