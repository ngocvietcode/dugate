'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Compatibility redirect for older links. Profile Release now lives inline on the
 * Profile screen, where admins can import a bundle before selecting its target.
 */
export default function ProfileReleasePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/profiles');
  }, [router]);

  return <main className="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">Đang chuyển đến Profiles…</main>;
}
