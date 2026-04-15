// app/settings/page.tsx
// Trang cài đặt AI provider — Admin only
import SettingsForm from '@/components/SettingsForm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'ADMIN') {
    redirect('/');
  }
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-zinc-100 mb-2">Cài đặt Hệ thống</h1>
        <p className="text-slate-500 dark:text-zinc-400 text-base font-medium">
          Cấu hình API key, Model AI và tùy chỉnh các tham số hướng dẫn (Prompt) mặc định cho AI.
        </p>
      </div>
      <SettingsForm />
    </main>
  );
}
