import ServiceTestClient from '@/components/ServiceTestClient';
import { buildServiceUiSchema } from '@/lib/endpoints/uiSchema';

export const metadata = { title: 'Biến đổi Nội dung | AI SkillHub' };

export default function TransformPage() {
  const ui = buildServiceUiSchema('transform');
  return (
    <ServiceTestClient
      serviceSlug="transform"
      title="Biến đổi Định dạng & Nội dung"
      description="Thay đổi định dạng, dịch thuật, viết lại văn phong, ẩn PII, điền form theo mẫu hoặc tách trang. Định tuyến qua tham số action: convert, translate, rewrite, redact, template, split."
      discriminatorName={ui.discriminatorName}
      discriminatorLabel={ui.discriminatorLabel}
      discriminatorOptions={ui.discriminatorOptions}
      subCaseFields={ui.subCaseFields}
    />
  );
}
