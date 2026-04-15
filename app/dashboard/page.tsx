// app/dashboard/page.tsx
// Dashboard / Monitoring Interface for Pipeline & Connectors

import DashboardView from '@/components/DashboardView';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { canMutate } from '@/lib/rbac';

export const metadata = {
  title: 'Dashboard | Dugate Document AI',
  description: 'Monitor request flows, API pipeline usage, and costs.',
};

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  
  if (!session || !canMutate(session.user.role)) {
    redirect('/login');
  }

  return (
    <main className="py-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-2">Observability Dashboard</h1>
        <p className="text-muted-foreground text-base max-w-3xl">
          Track inbound requests, token limits, and pipeline execution states over time.
        </p>
      </div>
      <DashboardView />
    </main>
  );
}
