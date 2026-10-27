import ServiceTestClient from '@/components/ServiceTestClient';
import { buildServiceUiSchema } from '@/lib/endpoints/uiSchema';

export const metadata = { title: 'Trích xuất Dữ liệu | AI SkillHub' };

export default function ExtractPage() {
  const ui = buildServiceUiSchema('extract');
  return (
    <ServiceTestClient
      serviceSlug="extract"
      title="Trích xuất Dữ liệu Cấu trúc"
      description="Biến tài liệu phi cấu trúc (PDF, ảnh, DOCX, Excel) thành JSON. Định tuyến qua tham số type: các preset theo domain nghiệp vụ, custom (schema động qua fields/schema) và query (hỏi đáp trên tài liệu)."
      discriminatorName={ui.discriminatorName}
      discriminatorLabel={ui.discriminatorLabel}
      discriminatorOptions={ui.discriminatorOptions}
      subCaseFields={ui.subCaseFields}
    />
  );
}
