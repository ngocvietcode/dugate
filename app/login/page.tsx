import { Suspense } from 'react';
import { FileText, BrainCircuit, AlertTriangle } from 'lucide-react';
import { LoginForm } from './LoginForm';
import { getSetting } from '@/lib/settings';
import { isSsoConfigured, ssoConfigurationError } from '@/lib/auth';

// Force dynamic rendering to evaluate environment variables at runtime
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Log which variables are missing for operators; the page itself stays generic
  // because it is reachable unauthenticated and need not enumerate the stack.
  if (!isSsoConfigured) {
    console.error(`[login] ${ssoConfigurationError()}`);
  }

  const homeMode = await getSetting('home_mode');
  const isDeveloper = homeMode === 'developer';

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background glow effects */}
      <div className="glow-emerald -top-40 -right-40 animate-pulse" />
      <div className="glow-red -bottom-40 -left-40 animate-pulse" style={{ animationDelay: '2s' }} />

      <div className="w-full max-w-md mx-4 relative z-10">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            {isDeveloper ? (
              <div className="bg-emerald-600 text-white p-3 rounded-xl">
                <FileText className="w-7 h-7" />
              </div>
            ) : (
              <div className="bg-primary text-primary-foreground p-3 rounded-2xl shadow-lg">
                <BrainCircuit className="w-8 h-8" />
              </div>
            )}
          </div>
          <h1 className={`font-bold tracking-tight text-foreground ${isDeveloper ? 'text-2xl font-mono' : 'text-3xl'}`}>
            {isDeveloper ? 'RPA.Doc' : 'AI Skill Hub'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isDeveloper ? 'Document Automation Engine' : 'Tổ hợp Kỹ năng Trí tuệ Nhân tạo Doanh nghiệp'}
          </p>
        </div>

        {/* Login Card */}
        <div className="modern-card p-8">
          <h2 className="text-xl font-semibold text-foreground mb-6 text-center">
            Đăng nhập hệ thống
          </h2>

          {isSsoConfigured ? (
            <Suspense fallback={
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            }>
              <LoginForm />
            </Suspense>
          ) : (
            /* SSO is the only way in, so an unconfigured deployment must say so
               instead of offering a button that cannot work. */
            <div
              role="alert"
              className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">Hệ thống chưa được cấu hình SSO</p>
                <p className="text-destructive/90">
                  Chưa thể đăng nhập. Vui lòng liên hệ bộ phận vận hành — chi tiết
                  cấu hình còn thiếu đã được ghi vào log hệ thống.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-muted-foreground text-xs mt-6">
          © {new Date().getFullYear()} {isDeveloper ? 'RPA.Doc • Document Automation Engine' : 'AI Skill Hub • Enterprise AI Services'}
        </p>
      </div>
    </div>
  );
}
