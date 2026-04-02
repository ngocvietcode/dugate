import ServiceTestClient from '@/components/ServiceTestClient';

export const metadata = { title: 'Tạo Nội dung AI | DUGate' };

export default function GeneratePage() {
  return (
    <ServiceTestClient
      serviceSlug="generate"
      title="Tạo sinh Văn bản"
      description="Chuyển hóa thông tin từ văn bản gốc thành Tóm tắt, Báo cáo chuyên sâu, Hỏi đáp (QA) hoặc Biên bản cuộc họp."
      discriminatorName="task"
      discriminatorOptions={[
        { label: 'Tóm tắt Nội dung (summary)', value: 'summary' },
        { label: 'Hỏi đáp Tài liệu - RAG (qa)', value: 'qa' },
        { label: 'Lên Dàn ý/Đề mục (outline)', value: 'outline' },
        { label: 'Viết Báo cáo (report)', value: 'report' },
        { label: 'Thảo Email theo chuẩn (email)', value: 'email' },
        { label: 'Làm Biên bản Họp (minutes)', value: 'minutes' },
      ]}
      extraFields={[
        { name: 'questions', label: 'Câu hỏi (Dành cho QA - Phân tách bằng phẩy)', type: 'textarea', placeholder: 'Hạn mức tín dụng là bao nhiêu?, Ai chịu phạt vi phạm?' },
        { name: 'max_words', label: 'Sợ lượng từ tối đa (max_words)', type: 'text', placeholder: 'VD: 500' },
        { name: 'format', label: 'Định dạng đầu ra', type: 'select', options: [
          { label: 'Văn xuôi (paragraph)', value: 'paragraph' },
          { label: 'Gạch đầu dòng (bullets)', value: 'bullets' },
          { label: 'Bảng (table)', value: 'table' },
        ] },
        { name: 'audience', label: 'Đối tượng người đọc (audience)', type: 'text', placeholder: 'Giám đốc, Chuyên gia kỹ thuật, Sinh viên...' },
      ]}
    />
  );
}
