'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { LogIn, AlertCircle, Eye, EyeOff, Shield } from 'lucide-react';

export function LoginForm({ oidcEnabled }: { oidcEnabled: boolean }) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  const handleSsoLogin = () => {
    setSsoLoading(true);
    signIn('oidc', { callbackUrl });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError(result.error);
      } else if (result?.ok) {
        // Use relative path only to avoid being redirected to the wrong host
        // when NEXTAUTH_URL is misconfigured in production.
        const destination = result.url
          ? new URL(result.url).pathname + new URL(result.url).search
          : callbackUrl;
        window.location.href = destination;
      }
    } catch {
      setError('Lỗi kết nối đến máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium text-foreground">
          Tài khoản
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Nhập tên đăng nhập"
          className="input-field"
          autoFocus
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Mật khẩu
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nhập mật khẩu"
            className="input-field pr-12"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="modern-button btn-primary w-full gap-2"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
      </button>

      {oidcEnabled && (
        <>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">hoặc</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <button
            type="button"
            onClick={handleSsoLogin}
            disabled={ssoLoading}
            className="modern-button btn-secondary w-full gap-2"
          >
            {ssoLoading ? (
              <div className="w-5 h-5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
            {ssoLoading ? 'Đang chuyển hướng...' : 'Đăng nhập qua SSO'}
          </button>
        </>
      )}
    </form>
  );
}
