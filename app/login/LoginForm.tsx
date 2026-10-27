'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Shield } from 'lucide-react';

/**
 * Maps a NextAuth `error` query value to an operator-facing message.
 *
 * Reaching this page with an error requires `pages.error = '/login'` in the auth
 * options; otherwise NextAuth serves its own generic error page. That matters most
 * for `AccessDenied`, which the signIn callback returns for any identity an ADMIN
 * has not provisioned — the expected outcome for a new joiner, and useless to them
 * without an explanation.
 *
 * Codes are the ones next-auth v4 actually emits (core/routes/{callback,signin}.js).
 */
function describeError(error: string): string {
  switch (error) {
    case 'AccessDenied':
      return 'Tài khoản của bạn chưa được cấp quyền truy cập hệ thống. Liên hệ quản trị viên để được tạo tài khoản trước khi đăng nhập.';
    case 'Configuration':
      return 'Hệ thống chưa được cấu hình SSO đúng. Liên hệ bộ phận vận hành.';
    case 'OAuthAccountNotLinked':
      return 'Danh tính SSO này đã được liên kết với một tài khoản khác. Liên hệ quản trị viên.';
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
    case 'Callback':
      return 'Không kết nối được tới nhà cung cấp SSO. Thử lại sau hoặc liên hệ bộ phận vận hành.';
    case 'SessionRequired':
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    default:
      return 'Đăng nhập không thành công. Thử lại hoặc liên hệ bộ phận vận hành.';
  }
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');
  const [ssoLoading, setSsoLoading] = useState(false);

  const handleSsoLogin = () => {
    setSsoLoading(true);
    signIn('oidc', { callbackUrl });
  };

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{describeError(error)}</span>
        </div>
      )}

      <p className="text-sm text-muted-foreground text-center">
        Hệ thống sử dụng đăng nhập một lần (SSO) của tổ chức.
      </p>

      <button
        type="button"
        onClick={handleSsoLogin}
        disabled={ssoLoading}
        className="modern-button btn-primary w-full gap-2"
      >
        {ssoLoading ? (
          <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
        ) : (
          <Shield className="w-4 h-4" />
        )}
        {ssoLoading ? 'Đang chuyển hướng...' : 'Đăng nhập qua SSO'}
      </button>
    </div>
  );
}
