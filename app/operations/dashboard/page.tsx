import BusinessOperationsPage from '../BusinessOperationsPage';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard | Operations',
  description: 'Phân tích nghiệp vụ: cases, tokens, chi phí và tỉ lệ thành công theo profile/operation.',
};

export default function OperationsDashboardPage() {
  return <BusinessOperationsPage />;
}
