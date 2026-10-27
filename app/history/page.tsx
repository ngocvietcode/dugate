// app/history/page.tsx
// Trang lịch sử transformation
// app/history/page.tsx
// Trang lịch sử transformation

import ConversionHistory from '@/components/ConversionHistory';

export default function HistoryPage() {
  return (
    <main className="py-12 max-w-6xl mx-auto px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">Lịch sử hoạt động</h1>
        <p className="text-muted-foreground text-base">Xem lại tất cả quá trình xử lý tài liệu, chuyển đổi, và so sánh.</p>
      </div>
      <ConversionHistory />
    </main>
  );
}
