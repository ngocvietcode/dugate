import ServiceTestClient from '@/components/ServiceTestClient';
import { buildServiceUiSchema } from '@/lib/endpoints/uiSchema';

export const metadata = { title: 'Phân tích & Đánh giá | AI SkillHub' };

export default function AnalyzePage() {
  const ui = buildServiceUiSchema('analyze');
  return (
    <ServiceTestClient
      serviceSlug="analyze"
      title="Phân tích & Đánh giá (NLU)"
      description="Phân tích, đánh giá, cho điểm và phân loại tài liệu. Định tuyến qua tham số task: classify (phân loại), compliance (kiểm tra tuân thủ), risk (đánh giá rủi ro), quality (chấm điểm chất lượng)."
      discriminatorName={ui.discriminatorName}
      discriminatorLabel={ui.discriminatorLabel}
      discriminatorOptions={ui.discriminatorOptions}
      subCaseFields={ui.subCaseFields}
    />
  );
}
