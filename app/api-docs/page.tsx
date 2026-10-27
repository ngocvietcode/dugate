'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';

// Swagger UI needs to be rendered purely client side as it accesses browser DOM
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen py-8 max-w-7xl mx-auto px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 dark:border-zinc-800 p-4">
        <SwaggerUI url="/api/swagger" />
      </div>
    </div>
  );
}
