import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'Nhập & Tiền xử lý | DUGate' };

export default function IngestPage() {
  return (
    <ServiceTestClient
      serviceSlug="ingest"
      title="Nhập & Tiền xử lý (Ingest)"
      description="Chuyển đổi file thô (PDF/DOCX/ảnh scan) thành text chuẩn hoá. Hỗ trợ Layout parser, OCR scan, và Digitizing."
      discriminatorName="mode"
      discriminatorOptions={[
        { label: 'Parse Layout mặc định (parse)', value: 'parse' },
        { label: 'Nhận dạng OCR (ocr)', value: 'ocr' },
        { label: 'Số hoá nâng cao (digitize)', value: 'digitize' },
        { label: 'Cắt PDF (split)', value: 'split' },
      ]}
      extraFields={[
        { name: 'pages', label: 'Trang cần cắt (Dùng cho mode=split)', type: 'text', placeholder: 'VD: 1-5, 8' }
      ]}
    />
  );
}
