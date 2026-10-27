// app/doc-pipeline/lib/mock-data.ts
// Utility helpers for the AI Pipeline Demo UI.

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getFileIcon(name: string): string {
  if (name.endsWith('.pdf')) return '📄';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '📊';
  if (name.endsWith('.zip')) return '📦';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return '🖼️';
  return '📎';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Initial Pipeline Steps ───────────────────────────────────────────────────

export function getInitialSteps() {
  return [
    {
      id: 'classify',
      title: 'AI Classify',
      subtitle: 'Phân loại tài liệu & Đặt tên chuẩn hóa',
      icon: '🏷️',
      accentColor: 'from-violet-500 to-indigo-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isParallel: true,
      isCollapsed: false,
    },
    {
      id: 'ocr',
      title: 'OCR & Bóc tách (Song song)',
      subtitle: 'Nhận dạng ký tự & Trích xuất dữ liệu',
      icon: '🔍',
      accentColor: 'from-cyan-500 to-blue-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isParallel: true,
      isCollapsed: false,
    },
    {
      id: 'crosscheck',
      title: 'AI Cross-check',
      subtitle: 'Đối chiếu chứng từ & Nghị quyết',
      icon: '⚖️',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'totrinh',
      title: 'AI Agent Tờ trình',
      subtitle: 'Soạn tờ trình đánh giá tuân thủ',
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
