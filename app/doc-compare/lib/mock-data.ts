// app/doc-compare/lib/mock-data.ts

export function getFileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📄';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '📊';
  return '📎';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function getInitialSteps() {
  return [
    {
      id: 'ocr',
      title: 'OCR Full-text',
      subtitle: 'Chuyển đổi 2 văn bản → Markdown (ext-doc-layout)',
      icon: '📝',
      accentColor: 'from-violet-500 to-indigo-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isParallel: true,
      isCollapsed: false,
    },
    {
      id: 'toc',
      title: 'Phân tích Mục lục',
      subtitle: 'Trích xuất cấu trúc mục lục của từng văn bản',
      icon: '📑',
      accentColor: 'from-blue-500 to-cyan-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'compare',
      title: 'So sánh từng Mục',
      subtitle: 'Đối chiếu, phát hiện mục thêm/xóa/sửa đổi',
      icon: '🔍',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'report',
      title: 'Báo cáo So sánh',
      subtitle: 'Tổng hợp báo cáo chi tiết các thay đổi',
      icon: '📋',
      accentColor: 'from-emerald-500 to-teal-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
  ];
}
