import type { Metadata } from 'next';
import './v2.css';

export const metadata: Metadata = {
  title: 'Thẩm định hồ sơ vay (v2)',
  description: 'Giao diện thẩm định hồ sơ vay phiên bản 2.',
};

export default function LoanAppraisalV2Layout({ children }: { children: React.ReactNode }) {
  return <div className="la2-root min-h-screen bg-background text-foreground">{children}</div>;
}
