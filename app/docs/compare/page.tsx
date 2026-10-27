import ServiceTestClient from '@/components/ServiceTestClient';
import { buildServiceUiSchema } from '@/lib/endpoints/uiSchema';

export const metadata = { title: 'So sánh & Đối chiếu | AI SkillHub' };

export default function ComparePage() {
  const ui = buildServiceUiSchema('compare');
  return (
    <ServiceTestClient
      serviceSlug="compare"
      title="So sánh & Đối chiếu Tài liệu"
      description="Đối chiếu 2+ nguồn dữ liệu và phát hiện sai lệch. Định tuyến qua tham số mode: verify (đối chiếu với nguồn tham chiếu), diff (so sánh từng dòng), semantic (so sánh ngữ nghĩa), version (sinh changelog). Nạp source_file + target_file."
      discriminatorName={ui.discriminatorName}
      discriminatorLabel={ui.discriminatorLabel}
      discriminatorOptions={ui.discriminatorOptions}
      subCaseFields={ui.subCaseFields}
      isCompareMode={true}
    />
  );
}
