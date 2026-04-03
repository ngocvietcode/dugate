import type { Metadata } from "next";
import { Plus_Jakarta_Sans, DM_Sans, Be_Vietnam_Pro, Inter } from "next/font/google";
import "./globals.css";
import { ensureCleanupScheduled } from "@/lib/cleanup-scheduler";
import HeaderNav from "@/components/HeaderNav";
import PageWrapper from "@/components/PageWrapper";
import { ThemeProvider } from "@/components/ThemeProvider";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { Toaster } from 'sonner';

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "dugate - Document Understanding Gateway",
  description: "Trợ lý AI phân tích và xử lý tài liệu đa định dạng (PDF/DOCX) sang cấu trúc dữ liệu tối ưu.",
};

// Cleanup scheduler: chạy 1 lần khi server start, lặp mỗi 6 tiếng
ensureCleanupScheduled();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${jakarta.variable} ${dmSans.variable} ${beVietnam.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className="font-sans bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary transition-colors duration-300">
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
