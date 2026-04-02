import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'Chuyển đổi Nội dung | DUGate' };

export default function TransformPage() {
  return (
    <ServiceTestClient
      serviceSlug="transform"
      title="Biến đổi & Tạo lại Format"
      description="Thay đổi cấu trúc trình bày, dịch thuật ngôn ngữ, ẩn PII tự động hoặc điền form bằng nội dung tự động."
      discriminatorName="action"
      discriminatorOptions={[
        { label: 'Chuyển đổi File Dạng Thô (convert)', value: 'convert' },
        { label: 'Dịch thuật Đa Ngôn ngữ (translate)', value: 'translate' },
        { label: 'Viết lại bằng Tone khác (rewrite)', value: 'rewrite' },
        { label: 'Bôi đen dữ liệu Mật PII (redact)', value: 'redact' },
        { label: 'Điền form Template (template)', value: 'template' },
      ]}
      extraFields={[
        { name: 'target_language', label: 'Ngôn ngữ đích (translate)', type: 'select', options: [
          { label: 'Tiếng Anh (en)', value: 'en' },
          { label: 'Tiếng Nhật (ja)', value: 'ja' },
          { label: 'Tiếng Việt (vi)', value: 'vi' }
        ] },
        { name: 'tone', label: 'Ngữ điệu (translate, rewrite)', type: 'select', options: [
          { label: 'Chuyên nghiệp', value: 'professional' },
          { label: 'Kinh doanh', value: 'business' },
          { label: 'Giao tiếp gần gũi', value: 'casual' }
        ] },
        { name: 'style', label: 'Văn phong (rewrite)', type: 'select', options: [
          { label: 'Tóm tắt (concise)', value: 'concise' },
          { label: 'Biểu cảm (expressive)', value: 'expressive' },
        ] },
        { name: 'redact_patterns', label: 'Regex bôi đen (redact)', type: 'text', placeholder: 'VD: /[A-Z]{2}[0-9]{6}/g (Che số CMND)' },
        { name: 'template', label: 'Mẫu điền form (template)', type: 'textarea', placeholder: '{ "CongTy": "Tên cty mới", "GiaTr": "1.000$" }' },
      ]}
    />
  );
}
