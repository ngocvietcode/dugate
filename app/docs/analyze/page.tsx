import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'Phân tích & Đánh giá | DUGate' };

export default function AnalyzePage() {
  return (
    <ServiceTestClient
      serviceSlug="analyze"
      title="Phân tích Trí tuệ (NLU)"
      description="Cung cấp các công cụ hiểu sâu văn bản: phân loại danh mục, đánh giá cảm xúc (sentiment), đối chiếu luật & rủi ro hợp đồng."
      discriminatorName="task"
      discriminatorOptions={[
        { label: 'Phân loại Tài liệu (classify)', value: 'classify' },
        { label: 'Phân tích Cảm xúc (sentiment)', value: 'sentiment' },
        { label: 'Kiểm tra Pháp chế (compliance)', value: 'compliance' },
        { label: 'Kiểm chứng Sự thật (fact-check)', value: 'fact-check' },
        { label: 'Chấm điểm Văn phong (quality)', value: 'quality' },
        { label: 'Quét Rủi ro Hợp pháp (risk)', value: 'risk' },
      ]}
      extraFields={[
        { name: 'categories', label: 'Danh mục phân loại (Dành cho classify)', type: 'text', placeholder: 'Hợp đồng, CV Xin việc, Báo cáo, Hóa đơn...' },
        { name: 'criteria', label: 'Bộ Tiêu chí (Dành cho compliance, quality, risk)', type: 'textarea', placeholder: 'VD: Phải có đủ chữ ký hai bên. Thời hạn trên 12 tháng.' },
        { name: 'reference_data', label: 'Dữ liệu tham chiếu (Dành cho fact-check JSON)', type: 'textarea', placeholder: '{"thoi_han": "24 tháng", "lai_suat": "5%"}' }
      ]}
    />
  );
}
