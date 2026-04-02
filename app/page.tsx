// app/page.tsx
// Trang chủ DUGate — thiết kế lại theo DU Integration Guide

import Link from 'next/link';
import {
  FileText, GitCompareArrows, ArrowRight, Sparkles, ShieldCheck,
  ScanText, BrainCircuit, Repeat2, Layers, Zap, Clock,
  Globe2, KeyRound, Webhook, ArrowDown, CheckCircle2,
  Building2, Scale, UserCheck, ChevronRight, Lock
} from 'lucide-react';

// ── 6 Core Endpoints ──────────────────────────────────────────────────────────
const ENDPOINTS = [
  {
    method: 'POST',
    path: '/ingest',
    title: 'Nhập & Tiền xử lý',
    subtitle: 'Document Ingestion',
    description: 'Chuyển đổi file thô (PDF/DOCX/ảnh scan) thành text chuẩn hoá. Hỗ trợ 4 mode: parse, ocr, digitize, split.',
    icon: ScanText,
    color: 'emerald',
    gradient: 'from-emerald-500 to-teal-600',
    glow: 'shadow-emerald-500/20',
    modes: ['parse', 'ocr', 'digitize', 'split'],
    href: '/ingest',
  },
  {
    method: 'POST',
    path: '/extract',
    title: 'Trích xuất Dữ liệu',
    subtitle: 'Structured Extraction',
    description: 'Bóc tách thông tin có cấu trúc từ hóa đơn, hợp đồng, CCCD, biên lai và bảng biểu với schema JSON tùy biến.',
    icon: Layers,
    color: 'green',
    gradient: 'from-[#00B74F] to-emerald-700',
    glow: 'shadow-green-500/20',
    modes: ['invoice', 'contract', 'id-card', 'receipt', 'table', 'custom'],
    href: '/extract',
  },
  {
    method: 'POST',
    path: '/analyze',
    title: 'Phân tích & Đánh giá',
    subtitle: 'Deep Analysis',
    description: 'NLU chuyên sâu: phân loại, kiểm tra tuân thủ pháp lý, đánh giá rủi ro, xác minh dữ kiện và chấm điểm chất lượng.',
    icon: BrainCircuit,
    color: 'violet',
    gradient: 'from-violet-500 to-purple-700',
    glow: 'shadow-violet-500/20',
    modes: ['classify', 'compliance', 'risk', 'fact-check', 'sentiment', 'quality'],
    href: '/analyze',
  },
  {
    method: 'POST',
    path: '/transform',
    title: 'Chuyển đổi Nội dung',
    subtitle: 'Content Transform',
    description: 'Đổi định dạng, dịch thuật đa ngôn ngữ, viết lại văn phong, bôi đen PII tự động và điền form theo template.',
    icon: Repeat2,
    color: 'sky',
    gradient: 'from-sky-500 to-blue-700',
    glow: 'shadow-sky-500/20',
    modes: ['convert', 'translate', 'rewrite', 'redact', 'template'],
    href: '/transform',
  },
  {
    method: 'POST',
    path: '/generate',
    title: 'Tạo Nội dung AI',
    subtitle: 'Content Generation',
    description: 'Sinh văn bản mới hoàn toàn từ tài liệu gốc: tóm tắt, Q&A, dàn bài, báo cáo phân tích, email phản hồi, biên bản họp.',
    icon: Sparkles,
    color: 'amber',
    gradient: 'from-amber-500 to-orange-600',
    glow: 'shadow-amber-500/20',
    modes: ['summary', 'qa', 'outline', 'report', 'email', 'minutes'],
    href: '/generate',
  },
  {
    method: 'POST',
    path: '/compare',
    title: 'So sánh Tài liệu',
    subtitle: 'Document Compare',
    description: 'Phát hiện sự khác biệt giữa hai phiên bản tài liệu: diff từng dòng, so sánh ngữ nghĩa pháp lý, tạo changelog.',
    icon: GitCompareArrows,
    color: 'rose',
    gradient: 'from-rose-500 to-red-700',
    glow: 'shadow-rose-500/20',
    modes: ['diff', 'semantic', 'version'],
    href: '/compare',
  },
];

// ── Async Flow Steps ──────────────────────────────────────────────────────────
const ASYNC_STEPS = [
  {
    step: '01',
    icon: FileText,
    title: 'Gửi Request',
    desc: 'POST file + tham số tới endpoint tương ứng với API Key.',
    code: '202 Accepted → op-abc123',
    color: 'from-[#00B74F] to-emerald-600',
  },
  {
    step: '02',
    icon: Clock,
    title: 'Chờ xử lý',
    desc: 'Hệ thống trả ngay operation ID. Client polling hoặc nhận Webhook.',
    code: 'state: "RUNNING"',
    color: 'from-sky-500 to-blue-600',
  },
  {
    step: '03',
    icon: CheckCircle2,
    title: 'Nhận kết quả',
    desc: 'Khi done=true, kết quả JSON đầy đủ sẵn sàng để consume.',
    code: 'done: true → result: {...}',
    color: 'from-violet-500 to-purple-600',
  },
];

// ── Real-World Use Cases ──────────────────────────────────────────────────────
const USE_CASES = [
  {
    icon: Building2,
    tag: 'Ngân hàng',
    title: 'Trích xuất & Kiểm tra Rủi ro Tín dụng',
    desc: 'Tự động bóc tách thời hạn, lãi suất từ hợp đồng tín dụng và đánh dấu WARNING khi lãi suất vượt ngưỡng 20%/năm.',
    endpoints: ['/extract', '/analyze'],
    gradient: 'from-green-500/10 to-emerald-500/5',
    border: 'border-green-500/20',
    badgeColor: 'bg-green-500/10 text-green-600 dark:text-green-400',
  },
  {
    icon: Scale,
    tag: 'Pháp chế',
    title: 'So sánh Hợp đồng Ngữ nghĩa',
    desc: 'Phát hiện các điều khoản bị thay đổi ý nghĩa pháp lý giữa hai bản hợp đồng, bỏ qua lỗi chính tả và khoảng trắng vô nghĩa.',
    endpoints: ['/compare'],
    gradient: 'from-violet-500/10 to-purple-500/5',
    border: 'border-violet-500/20',
    badgeColor: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    icon: UserCheck,
    tag: 'Nhân sự',
    title: 'Lọc Hồ sơ Ứng viên Tự động',
    desc: 'Kiểm tra IELTS/TOEIC, bằng cấp và khoảng gap year theo đúng tiêu chuẩn tuyển dụng, trả về PASS/FAIL kèm lý do chi tiết.',
    endpoints: ['/analyze'],
    gradient: 'from-sky-500/10 to-blue-500/5',
    border: 'border-sky-500/20',
    badgeColor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
];

// ── Admin Features ────────────────────────────────────────────────────────────
const ADMIN_FEATURES = [
  { icon: KeyRound, title: 'Client Profiles & API Keys', desc: 'Cấp phát và quản lý API Key theo từng Client với cấu hình riêng biệt.' },
  { icon: Lock, title: 'Business Rules Override', desc: 'Nhúng quy tắc nghiệp vụ ẩn vào mỗi Endpoint mà Client không thể thấy.' },
  { icon: Globe2, title: 'External API Connectors', desc: 'Kết nối OCR nội hạt, Local LLM hoặc bất kỳ hệ thống AI tùy biến nào.' },
  { icon: Webhook, title: 'Model Override', desc: 'Ép dùng mô hình AI cụ thể (GPT-4o / Claude / Gemini) theo gói đăng ký.' },
];

// ── Stat Numbers ──────────────────────────────────────────────────────────────
const STATS = [
  { value: '6', label: 'Core Endpoints' },
  { value: '30+', label: 'Tham số hành động' },
  { value: '15+', label: 'AI Connectors' },
  { value: '<3s', label: 'Latency trung bình' },
];

const COLOR_MAP: Record<string, string> = {
  emerald: 'text-emerald-500',
  green: 'text-green-500',
  violet: 'text-violet-500',
  sky: 'text-sky-500',
  amber: 'text-amber-500',
  rose: 'text-rose-500',
};

export default function Home() {
  return (
    <main className="flex-1 relative overflow-hidden bg-background transition-colors duration-300">

      {/* ── Ambient Background ─────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full bg-[#00B74F]/15 dark:bg-[#00B74F]/8 blur-[120px]" />
        <div className="absolute top-[30%] right-[-15%] w-[500px] h-[500px] rounded-full bg-violet-500/10 dark:bg-violet-500/6 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[15%] w-[700px] h-[700px] rounded-full bg-sky-400/10 dark:bg-sky-400/5 blur-[140px]" />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO SECTION
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative text-center max-w-5xl mx-auto px-6 pt-20 pb-16">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border shadow-sm mb-8 text-sm font-semibold text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-[#00B74F] animate-pulse" />
          AI-Powered Document Intelligence Platform
          <span className="ml-1 px-2 py-0.5 text-xs bg-[#00B74F]/10 text-[#00B74F] rounded-full font-bold">v1 API</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-foreground mb-6 leading-[1.05]">
          Tự động hoá{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00B74F] via-emerald-400 to-sky-500">
            mọi nghiệp vụ
          </span>
          <br />xử lý tài liệu
        </h1>

        {/* Subheadline */}
        <p className="text-xl text-muted-foreground mb-4 max-w-2xl mx-auto leading-relaxed">
          DUGate API cung cấp <strong className="text-foreground">6 endpoint cốt lõi</strong> bao phủ toàn bộ vòng đời tài liệu — từ nhập liệu, trích xuất, phân tích, chuyển đổi, sinh nội dung đến so sánh phiên bản.
        </p>
        <p className="text-sm text-muted-foreground mb-10">
          Base URL: <code className="px-2 py-0.5 rounded-md bg-muted text-foreground font-mono text-xs">https://api.dugate.vn/api/v1</code>
          &nbsp;·&nbsp; Auth: <code className="px-2 py-0.5 rounded-md bg-muted text-foreground font-mono text-xs">x-api-key: dg_xxxx</code>
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#endpoints"
            className="modern-button btn-primary bg-[#00B74F] text-white hover:bg-[#009940] shadow-lg shadow-[#00B74F]/30 px-8 font-bold"
          >
            <Zap className="w-4 h-4 mr-2" />
            Khám phá 6 Endpoints
          </a>
          <Link href="/api-docs" className="modern-button btn-outline px-8 font-bold">
            <FileText className="w-4 h-4 mr-2 text-muted-foreground" />
            Xem API Docs
          </Link>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-16 max-w-2xl mx-auto">
          {STATS.map((s) => (
            <div key={s.label} className="modern-card p-4 text-center">
              <p className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#00B74F] to-sky-500">
                {s.value}
              </p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          ASYNC FLOW
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative max-w-5xl mx-auto px-6 pb-20">
        <div className="text-center mb-10">
          <span className="text-xs font-bold uppercase tracking-widest text-[#00B74F] mb-2 block">Cơ chế vận hành</span>
          <h2 className="text-3xl font-bold text-foreground">Luồng Bất Đồng Bộ (Async Pattern)</h2>
          <p className="text-muted-foreground mt-2 max-w-lg mx-auto">Mọi tác vụ nặng đều trả về <strong>Operation ID</strong> ngay lập tức. Client dùng Polling hoặc Webhook để nhận kết quả.</p>
        </div>

        <div className="flex flex-col md:flex-row items-stretch gap-4">
          {ASYNC_STEPS.map((step, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-3">
              <div className={`modern-card w-full p-6 text-center group hover:scale-[1.02] transition-transform duration-200`}>
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center mx-auto mb-4 shadow-lg`}>
                  <step.icon className="w-6 h-6 text-white" />
                </div>
                <div className="text-xs font-bold text-muted-foreground mb-1">BƯỚC {step.step}</div>
                <h3 className="text-lg font-bold text-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{step.desc}</p>
                <code className="text-xs bg-muted px-2 py-1 rounded-md font-mono text-foreground/80">{step.code}</code>
              </div>
              {idx < ASYNC_STEPS.length - 1 && (
                <div className="hidden md:block absolute" />
              )}
              {idx < ASYNC_STEPS.length - 1 && (
                <div className="flex md:hidden w-8 h-8 items-center justify-center">
                  <ArrowDown className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* connector arrows between flex items on desktop */}
        <div className="hidden md:flex absolute inset-0 pointer-events-none items-center justify-evenly px-[20%]">
          {/* These are decorative, rendered via the layout */}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          6 CORE ENDPOINTS
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="endpoints" className="relative max-w-7xl mx-auto px-6 pb-24 scroll-mt-24">
        <div className="text-center mb-12">
          <span className="text-xs font-bold uppercase tracking-widest text-[#00B74F] mb-2 block">API Design</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">6 Endpoint Cốt Lõi</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Kiến trúc tối giản endpoint, tối đa nghiệp vụ thông qua tham số hành động động.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ENDPOINTS.map((ep, idx) => (
            <Link
              key={idx}
              href={ep.href}
              className="modern-card group relative overflow-hidden flex flex-col p-7 cursor-pointer hover:scale-[1.02] transition-all duration-300"
            >
              {/* Gradient glow on hover */}
              <div className={`absolute inset-0 bg-gradient-to-br ${ep.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300 rounded-3xl`} />

              {/* Header */}
              <div className="flex items-start gap-4 mb-5">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${ep.gradient} flex items-center justify-center shadow-lg ${ep.glow} shadow-lg flex-shrink-0 group-hover:-translate-y-1 transition-transform duration-300`}>
                  <ep.icon className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{ep.method}</span>
                    <code className={`text-sm font-bold font-mono ${COLOR_MAP[ep.color]}`}>{ep.path}</code>
                  </div>
                  <h3 className="text-lg font-bold text-foreground leading-tight">{ep.title}</h3>
                  <p className="text-xs text-muted-foreground">{ep.subtitle}</p>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">
                {ep.description}
              </p>

              {/* Mode badges */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {ep.modes.map((mode) => (
                  <span key={mode} className="px-2 py-0.5 text-xs font-mono font-semibold bg-muted rounded-md text-foreground/70">
                    {mode}
                  </span>
                ))}
              </div>

              {/* Footer */}
              <div className={`flex items-center text-sm font-semibold ${COLOR_MAP[ep.color]} mt-auto`}>
                Xem chi tiết
                <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          REAL-WORLD USE CASES
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-12">
          <span className="text-xs font-bold uppercase tracking-widest text-[#00B74F] mb-2 block">Kịch bản thực tế</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">Ứng Dụng Thực Tiễn</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Kết hợp đa endpoint với Admin Override để giải quyết các bài toán nghiệp vụ phức tạp.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {USE_CASES.map((uc, idx) => (
            <div
              key={idx}
              className={`modern-card p-7 bg-gradient-to-br ${uc.gradient} border ${uc.border} hover:scale-[1.02] transition-all duration-300`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className={`px-3 py-1 rounded-full text-xs font-bold ${uc.badgeColor}`}>
                  {uc.tag}
                </div>
              </div>
              <uc.icon className="w-8 h-8 text-foreground/60 mb-4" />
              <h3 className="text-lg font-bold text-foreground mb-3 leading-tight">{uc.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">{uc.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {uc.endpoints.map((ep) => (
                  <span key={ep} className="px-2 py-0.5 text-xs font-mono font-bold bg-card border border-border rounded-md text-foreground/80">
                    {ep}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          ADMIN CONTROL PANEL (Feature Highlight)
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative max-w-6xl mx-auto px-6 pb-24">
        <div className="modern-card overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            {/* Left: Text */}
            <div className="lg:w-2/5 p-10 lg:p-12 flex flex-col justify-center">
              <span className="text-xs font-bold uppercase tracking-widest text-[#00B74F] mb-3 block">Dành cho Admin</span>
              <h2 className="text-3xl font-bold text-foreground mb-4 leading-tight">
                Kiểm soát toàn diện qua Admin Dashboard
              </h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Profile-Endpoint Configuration cho phép Admin cài cắm quy tắc nghiệp vụ ẩn, kiểm soát LLM model, bôi đen dữ liệu nhạy cảm và kết nối AI ngoại vi — tất cả <strong className="text-foreground">hoàn toàn ẩn với Client</strong>.
              </p>
              <Link href="/profiles" className="modern-button bg-[#00B74F] text-white hover:bg-[#009940] px-6 font-bold shadow-lg shadow-[#00B74F]/25 w-fit">
                Quản lý Profiles
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </div>

            {/* Right: Feature Grid */}
            <div className="lg:w-3/5 bg-muted/30 p-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ADMIN_FEATURES.map((f, idx) => (
                <div key={idx} className="bg-card rounded-2xl border border-border p-5 hover:border-[#00B74F]/30 hover:shadow-md transition-all duration-200">
                  <div className="w-9 h-9 rounded-xl bg-[#00B74F]/10 flex items-center justify-center mb-3">
                    <f.icon className="w-5 h-5 text-[#00B74F]" />
                  </div>
                  <h4 className="font-bold text-foreground text-sm mb-1">{f.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          CTA FOOTER SECTION
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative max-w-4xl mx-auto px-6 pb-28 text-center">
        <div className="modern-card p-12 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-[#00B74F]/8 via-transparent to-sky-500/8 pointer-events-none" />
          <div className="relative">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[#00B74F] to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-[#00B74F]/30">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
              Bắt đầu tích hợp ngay hôm nay
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto leading-relaxed">
              Một API Key, sáu endpoint, vô hạn khả năng. Kết nối DUGate vào hệ thống của bạn trong vài phút.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/settings" className="modern-button bg-[#00B74F] text-white hover:bg-[#009940] px-8 font-bold shadow-lg shadow-[#00B74F]/30 text-base">
                <KeyRound className="w-4 h-4 mr-2" />
                Lấy API Key
              </Link>
              <Link href="/api-connections" className="modern-button btn-outline px-8 font-bold text-base">
                <Globe2 className="w-4 h-4 mr-2 text-muted-foreground" />
                API Connections
              </Link>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
