import ServiceTestClient from '@/components/ServiceTestClient';
import { buildServiceUiSchema } from '@/lib/endpoints/uiSchema';

export const metadata = { title: 'Tạo Nội dung AI | AI SkillHub' };

export default function GeneratePage() {
  const ui = buildServiceUiSchema('generate');
  return (
    <ServiceTestClient
      serviceSlug="generate"
      title="Sinh Nội dung Văn bản"
      description="Chuyển hóa thông tin từ tài liệu gốc thành nội dung mới. Định tuyến qua tham số task: summary (tóm tắt), report (báo cáo/tờ trình), email (soạn email), minutes (biên bản họp)."
      discriminatorName={ui.discriminatorName}
      discriminatorLabel={ui.discriminatorLabel}
      discriminatorOptions={ui.discriminatorOptions}
      subCaseFields={ui.subCaseFields}
    />
  );
}
