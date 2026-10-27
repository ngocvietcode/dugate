'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; label: string }
interface State { failed: boolean }

/** Một panel lỗi render không được làm sập cả trang. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[loan-appraisal-v2] ${this.props.label}:`, error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-[rgb(var(--la2-danger)/0.35)] bg-[rgb(var(--la2-danger)/0.10)] p-4 text-sm text-[rgb(var(--la2-danger))]">
        <p className="font-semibold">Không hiển thị được: {this.props.label}</p>
        <p className="mt-1 text-xs">Dữ liệu kết quả có thể thiếu hoặc sai cấu trúc. Các phần khác của trang vẫn dùng được.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-semibold">
          Thử lại
        </button>
      </div>
    );
  }
}
