import { Suspense } from 'react';
import { BrainCircuit } from 'lucide-react';
import { LoginForm } from './LoginForm';

// Force dynamic rendering to evaluate environment variables at runtime
export const dynamic = 'force-dynamic';

// LoginForm moved to ./LoginForm.tsx

export default function LoginPage() {
  const oidcEnabled = process.env.OIDC_ENABLED === 'true' || process.env.NEXT_PUBLIC_OIDC_ENABLED === 'true';

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background glow effects */}
      <div className="glow-emerald -top-40 -right-40 animate-pulse" />
      <div className="glow-red -bottom-40 -left-40 animate-pulse" style={{ animationDelay: '2s' }} />

      <div className="w-full max-w-md mx-4 relative z-10">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-lg">
              <BrainCircuit className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            AI Skill Hub
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tổ hợp Kỹ năng Trí tuệ Nhân tạo Doanh nghiệp
          </p>
        </div>

        {/* Login Card */}
        <div className="modern-card p-8">
          <h2 className="text-xl font-semibold text-foreground mb-6 text-center">
            Đăng nhập hệ thống
          </h2>

          <Suspense fallback={
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          }>
            <LoginForm oidcEnabled={oidcEnabled} />
          </Suspense>
        </div>

        <p className="text-center text-muted-foreground text-xs mt-6">
          © {new Date().getFullYear()} AI Skill Hub • Enterprise AI Services
        </p>
      </div>
    </div>
  );
}
