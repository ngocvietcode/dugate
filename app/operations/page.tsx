import LegacyOperationsPage from './LegacyOperationsPage';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Operations | Giám sát request',
  description: 'Giám sát & điều khiển request: theo dõi, phát hiện issue, dừng/tiếp tục.',
};

export default function OperationsPage() {
  return <LegacyOperationsPage />;
}
