// app/lc-checker/lib/mock-data.ts
// Utility helpers for the LC Checker UI.

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

// ─── Initial Pipeline Steps (LC Checker) ──────────────────────────────────────

export function getInitialSteps() {
  return [
    {
      id: 'classify',
      title: 'OCR Full-text',
      subtitle: 'Chuyển đổi PDF → Markdown text (ext-doc-layout)',
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
      id: 'compliance',
      title: 'Kiểm tra Tuân thủ UCP 600',
      subtitle: 'Đối chiếu theo UCP 600, ISBP 821 & phát hiện Discrepancy',
      icon: '⚖️',
      accentColor: 'from-amber-500 to-orange-600',
      status: 'pending' as const,
      progress: 0,
      output: null,
      duration: null,
      isCollapsed: false,
    },
    {
      id: 'report',
      title: 'Báo cáo Kiểm tra LC',
      subtitle: 'Soạn LC Checking Report cho Cán bộ Tác nghiệp TM',
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
