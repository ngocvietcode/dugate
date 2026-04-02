import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'Trích xuất Dữ liệu | DUGate' };

export default function ExtractPage() {
  return (
    <ServiceTestClient
      serviceSlug="extract"
      title="Trích xuất Dữ liệu Cấu trúc"
      description="Bóc tách thông tin từ Hóa đơn, Chứng minh nhân dân, Biên lai, Hợp đồng thành JSON JSON Schema tuỳ chỉnh."
      discriminatorName="type"
      discriminatorOptions={[
        { label: 'Hóa đơn đỏ / VAT (invoice)', value: 'invoice' },
        { label: 'Hợp đồng (contract)', value: 'contract' },
        { label: 'CCCD / ID Card (id-card)', value: 'id-card' },
        { label: 'Biên lai Retail (receipt)', value: 'receipt' },
        { label: 'Bảng biểu 2 chiều (table)', value: 'table' },
        { label: 'Tùy biến Schema (custom)', value: 'custom' },
      ]}
      extraFields={[
        { name: 'fields', label: 'Các trường cần trích xuất (Phân cách bằng dấu phẩy)', type: 'textarea', placeholder: 'VD: Họ và tên, Ngày sinh, Quê quán' },
        { name: 'schema', label: 'JSON Schema bắt buộc (Tùy chọn)', type: 'textarea', placeholder: '{ "type": "object", "properties": { "name": { "type": "string" } } }' }
      ]}
    />
  );
}
