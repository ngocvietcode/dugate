'use client';

export default function LoanAppraisalV2Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <div role="alert" className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">Màn hình thẩm định gặp lỗi</h1>
        <p className="mt-2 text-sm text-muted-foreground">Đã xảy ra lỗi không mong muốn khi hiển thị trang. Bạn có thể thử tải lại.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Thử lại
        </button>
      </div>
    </main>
  );
}
