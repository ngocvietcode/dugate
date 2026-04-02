import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'So sánh & Đối chiếu | DUGate' };

export default function ComparePage() {
  return (
    <ServiceTestClient
      serviceSlug="compare"
      title="So Sánh Tài Liệu Kép"
      description="Tìm ra sự khác biệt giữa hai bản lưu văn bản: từ thay đổi nhỏ chính tả đến sai lệch ý nghĩa pháp lý sâu."
      discriminatorName="mode"
      discriminatorOptions={[
        { label: 'So sánh từng dòng (diff)', value: 'diff' },
        { label: 'So sánh theo Ngữ Nghĩa (semantic)', value: 'semantic' },
        { label: 'Sinh báo cáo Lịch sử Sửa đổi (version)', value: 'version' },
      ]}
      extraFields={[
        { name: 'focus', label: 'Vùng giám sát trọng tâm (semantic)', type: 'textarea', placeholder: 'Chỉ đối chiếu các phần: Trách nhiệm bồi thường, Chấm dứt hợp đồng' },
      ]}
      isCompareMode={true}
    />
  );
}
