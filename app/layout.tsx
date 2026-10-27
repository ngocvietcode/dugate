import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ensureCleanupScheduled } from "@/lib/cleanup-scheduler";
import { ensureStalledReaperScheduled } from "@/lib/stalled-reaper-scheduler";
import HeaderNav from "@/components/HeaderNav";
import PageWrapper from "@/components/PageWrapper";
import { ThemeProvider } from "@/components/ThemeProvider";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { Toaster } from 'sonner';

// Use system font stack — no external fetch needed during build.
// Google Fonts (Inter, DM Sans, Be Vietnam Pro, Plus Jakarta Sans) require internet access.
// In VPBank air-gapped environment, we fall back to system fonts with matching CSS variables.
const systemFontFallback = {
  variable: "--font-system",
  className: "font-sans",
};

const jakarta = systemFontFallback;
const dmSans = systemFontFallback;
const beVietnam = systemFontFallback;
const inter = systemFontFallback;

import { getSetting } from '@/lib/settings';

export async function generateMetadata(): Promise<Metadata> {
  let mode = 'showcase';
  try { mode = await getSetting('home_mode'); } catch {}
  const isDeveloper = mode === 'developer';
  return {
    title: isDeveloper
      ? 'RPA.Doc — Document Automation Engine'
      : 'AI Skill Hub — Enterprise AI Services',
    description: isDeveloper
      ? 'Document Intelligence module for RPA pipeline & system integration.'
      : 'Tổ hợp Kỹ năng Trí tuệ Nhân tạo cho Doanh nghiệp.',
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Cleanup scheduler: chạy 1 lần khi server start, lặp mỗi 6 tiếng
  // Must be called inside the function, not at module-level, to avoid DB connection during next build
  ensureCleanupScheduled();
  ensureStalledReaperScheduled();
  return (
    <html lang="vi" className={`${jakarta.variable} ${dmSans.variable} ${beVietnam.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className={`${beVietnam.className} bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary transition-colors duration-300`}>
        <SessionProviderWrapper>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <HeaderNav />
            <PageWrapper>{children}</PageWrapper>
            <Toaster position="top-center" richColors />
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
