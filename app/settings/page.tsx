// app/settings/page.tsx
// Trang cài đặt AI provider — Admin only

'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import SettingsForm from '@/components/SettingsForm';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || session.user.role !== 'ADMIN') {
      router.push('/');
    }
  }, [session, status, router]);

  if (status === 'loading' || !session || session.user.role !== 'ADMIN') {
    return null;
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
