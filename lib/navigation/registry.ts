// lib/navigation/registry.ts
// Single source of truth for all navigable application pages.
// HeaderNav, the /apps launcher, and any future breadcrumb/search all read from here.
// Add a new page = add one entry here, so pages never become "orphaned" (no UI entry).
//
// Visibility is CAPABILITY-based, not role-based. Because an ADMIN can grant or
// revoke individual OPS capabilities at runtime, a static role list would drift
// from what the server actually authorizes. Pages without a `capability` are open
// to any signed-in staff account.

import type { LucideIcon } from 'lucide-react';
import {
  SlidersHorizontal, PlugZap, Activity, Settings, Users, Layers, Gauge,
  FileSearch, ScanText, FileStack, GitCompare, FileSpreadsheet,
  Sparkles, Wrench, BookOpen, History, ClipboardCheck, ShieldCheck,
  Layers3, Landmark, LayoutDashboard, Wallet,
} from 'lucide-react';
import type { Capability } from '@/lib/rbac/capabilities';

/** Page lifecycle status — drives the badge shown in nav + launcher. */
export type PageStatus = 'stable' | 'beta' | 'internal' | 'deprecated';

/** Logical grouping for menu sections + launcher cards. */
export type PageGroup = 'services' | 'workflows' | 'admin' | 'monitoring' | 'docs';

export interface AppPage {
  /** Route path (must match the Next.js route). */
  path: string;
  /** Short display title. */
  title: string;
  /** One-line purpose — shown on the /apps launcher cards. */
  description: string;
  group: PageGroup;
  icon: LucideIcon;
  /**
   * Capability required to SEE this entry. Omit for pages available to every
   * signed-in staff account. The page itself must still enforce access.
   */
  capability?: Capability;
  /** Lifecycle status. `internal`/`deprecated` get a warning badge but stay visible. */
  status: PageStatus;
  /**
   * If true, the page is reachable by URL but NOT listed in the main nav dropdown.
   * It still appears on the /apps launcher (so it remains discoverable/manageable).
   */
  hiddenFromNav?: boolean;
}

export interface GroupMeta {
  key: PageGroup;
  label: string;
  order: number;
}

export const GROUP_META: Record<PageGroup, GroupMeta> = {
  services:   { key: 'services',   label: 'API Services',   order: 1 },
  workflows:  { key: 'workflows',  label: 'Nghiệp vụ',      order: 2 },
  monitoring: { key: 'monitoring', label: 'Giám sát',       order: 3 },
  admin:      { key: 'admin',      label: 'Quản trị',       order: 4 },
  docs:       { key: 'docs',       label: 'Tài liệu',       order: 5 },
};

export const APP_PAGES: AppPage[] = [
  // ── API Services (per-endpoint playground / test client) ──────────────────
  // 5 canonical skills (docs/AI_Skills). Legacy /ingest folded into extract + transform:split.
  { path: '/extract',   title: 'Extract',   description: 'Trích xuất JSON có cấu trúc từ hoá đơn, hợp đồng, CCCD, biên lai, bảng.', group: 'services', icon: FileSearch, status: 'stable' },
  { path: '/analyze',   title: 'Analyze',   description: 'Phân loại, đánh giá, fact-check, compliance, rủi ro tài liệu.', group: 'services', icon: ScanText,   status: 'stable' },
  { path: '/transform', title: 'Transform', description: 'Chuyển định dạng, dịch thuật, viết lại, che PII, áp template, tách trang (split).', group: 'services', icon: GitCompare, status: 'stable' },
  { path: '/generate',  title: 'Generate',  description: 'Sinh nội dung mới: tóm tắt, QA, outline, báo cáo, email, biên bản.', group: 'services', icon: Sparkles,   status: 'stable' },
  { path: '/compare',   title: 'Compare',   description: 'So sánh văn bản: diff, ngữ nghĩa, changelog phiên bản.', group: 'services', icon: FileStack,  status: 'stable' },

  // ── Business Workflows (orchestrators; một số build nhanh cho BU test) ─────
  { path: '/payroll-verify',   title: 'Đối chiếu Bảng lương',  description: 'Workflow đối chiếu bảng lương PDF vs Excel (OCR → Extract → Compare).', group: 'workflows', icon: ClipboardCheck, status: 'internal' },
  { path: '/lc-checker',       title: 'Kiểm tra Chứng từ LC',  description: 'Kiểm tra bộ chứng từ Letter of Credit theo UCP 600 / ISBP 821.', group: 'workflows', icon: ShieldCheck,   status: 'internal' },
  { path: '/financial-report', title: 'OCR & Dịch BCTC',      description: 'Workflow OCR + dịch báo cáo tài chính nước ngoài (chuẩn Nhật/EN) → JSON song ngữ chuẩn hóa.', group: 'workflows', icon: FileSpreadsheet, status: 'internal' },
  { path: '/statement-analyze', title: 'Phân tích Sao kê',    description: 'Workflow OCR sao kê ngân hàng PDF → trích xuất giao dịch → tính số dư bình quân, dòng tiền và các chỉ số tài chính.', group: 'workflows', icon: Landmark, status: 'internal' },
  { path: '/loan-appraisal-v2', title: 'Thẩm định Hồ sơ Vay',  description: 'Thẩm định bộ hồ sơ vay: upload tài liệu → phân loại → bóc tách → gom người & tài sản → checklist đủ/thiếu → đối chiếu chéo → thẩm định.', group: 'workflows', icon: ClipboardCheck, status: 'beta' },
  { path: '/loan-appraisal-v2/config', title: 'Cấu hình Thẩm định Vay', description: 'Cấu hình rule engine, rule LLM (phạm vi theo luồng FULL/FAST/SIMPLE và sản phẩm) và ngưỡng policy cho workflow thẩm định vay, theo từng Profile.', group: 'admin', icon: ClipboardCheck, capability: 'endpoint:manage', status: 'beta', hiddenFromNav: true },
  { path: '/account-opening',  title: 'Mở Tài khoản',         description: 'Tiếp nhận & đánh giá hồ sơ mở tài khoản theo phân khúc KHCN/HKD/SME/KHDN: checklist theo sản phẩm, Customer Profile, điều kiện mở, rà soát khách hàng (CDD) và tuyến rà soát.', group: 'workflows', icon: Wallet, status: 'beta' },
  { path: '/account-opening/config', title: 'Cấu hình Mở Tài khoản', description: 'Cấu hình rule engine, rule LLM, ngưỡng policy và danh mục chứng từ cho workflow mở tài khoản, theo từng Profile.', group: 'admin', icon: Wallet, capability: 'endpoint:manage', status: 'beta', hiddenFromNav: true },
  { path: '/structure-compare',title: 'So sánh Cấu trúc',      description: 'So sánh 2 phiên bản tài liệu với mapping cấu trúc thông minh.', group: 'workflows', icon: Layers3,       status: 'beta' },
  { path: '/doc-pipeline',     title: 'AI Document Pipeline',  description: 'Chạy thử pipeline xử lý tài liệu đa bước.', group: 'workflows', icon: FileStack,     status: 'internal' },
  { path: '/tracing-portal',   title: 'Kiểm quỹ CDM/ATM',     description: 'Upload biên bản kiểm quỹ CDM/ATM → OCR trích xuất & test chất lượng.', group: 'workflows', icon: ClipboardCheck, status: 'internal' },
  { path: '/ai-demo',          title: 'AI Demo',               description: 'Trang demo pipeline tài liệu AI (trình diễn).', group: 'workflows', icon: Sparkles,      status: 'internal' },

  // ── Monitoring ────────────────────────────────────────────────────────────
  { path: '/operations', title: 'Operations', description: 'Giám sát & điều khiển request: theo dõi, phát hiện issue, dừng/tiếp tục.', group: 'monitoring', icon: Activity, capability: 'operations:read', status: 'stable' },
  { path: '/operations/dashboard', title: 'Dashboard', description: 'Phân tích nghiệp vụ: cases, tokens, chi phí và tỉ lệ thành công theo profile/operation.', group: 'monitoring', icon: LayoutDashboard, capability: 'operations:read', status: 'stable' },
  { path: '/history',    title: 'Lịch sử',    description: 'Xem lại toàn bộ lịch sử xử lý, chuyển đổi, so sánh.', group: 'monitoring', icon: History,  capability: 'operations:read', status: 'stable' },
  { path: '/dashboard',  title: 'Observability', description: 'Theo dõi request, token, trạng thái pipeline theo thời gian.', group: 'monitoring', icon: Gauge, capability: 'observability:view', status: 'stable' },

  // ── Admin / Management ──────────────────────────────────────────────────────
  { path: '/profiles',                title: 'Profiles',         description: 'Cấu hình routing, override model/prompt/connector theo từng API Key.', group: 'admin', icon: SlidersHorizontal, capability: 'profile:read', status: 'stable' },
  { path: '/api-connections',         title: 'Connectors',       description: 'Quản lý External API Connectors (AI backends, endpoint, auth).', group: 'admin', icon: PlugZap, capability: 'connector:manage', status: 'stable' },
  { path: '/settings',                title: 'Cài đặt',          description: 'Cấu hình hệ thống chung.', group: 'admin', icon: Settings, capability: 'settings:manage', status: 'stable' },
  { path: '/settings/users',          title: 'Người dùng',       description: 'Quản lý tài khoản & phân quyền người dùng.', group: 'admin', icon: Users, capability: 'user:manage', status: 'stable' },
  { path: '/settings/worker-groups',  title: 'Worker Groups',    description: 'Quản lý Worker Groups & hàng đợi xử lý.', group: 'admin', icon: Layers, capability: 'workergroups:manage', status: 'stable' },
  { path: '/settings/queue-monitor',  title: 'Queue Monitor',    description: 'Giám sát hàng đợi BullMQ theo thời gian thực.', group: 'admin', icon: Wrench, capability: 'queue:view', status: 'beta' },

  // ── Docs ────────────────────────────────────────────────────────────────────
  { path: '/api-docs', title: 'API Docs', description: 'Tài liệu API tương tác (Swagger UI).', group: 'docs', icon: BookOpen, status: 'stable' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pages visible for a resolved capability set, optionally including nav-hidden
 * ones. Pass an empty set while permissions are still loading: that yields only
 * capability-free pages, so no privileged entry flashes before resolution.
 */
export function getPagesForCapabilities(
  permissions: ReadonlySet<Capability>,
  opts?: { includeHidden?: boolean },
): AppPage[] {
  return APP_PAGES.filter((page) =>
    (!page.capability || permissions.has(page.capability))
    && (opts?.includeHidden || !page.hiddenFromNav),
  );
}

/** Group pages (already capability-filtered) into ordered groups for rendering. */
export function groupPages(pages: AppPage[]): Array<{ meta: GroupMeta; pages: AppPage[] }> {
  const byGroup = new Map<PageGroup, AppPage[]>();
  for (const p of pages) {
    const list = byGroup.get(p.group) ?? [];
    list.push(p);
    byGroup.set(p.group, list);
  }
  return Array.from(byGroup.entries())
    .map(([key, list]) => ({ meta: GROUP_META[key], pages: list }))
    .sort((a, b) => a.meta.order - b.meta.order);
}

/** Status badge presentation metadata. */
export const STATUS_META: Record<PageStatus, { label: string; className: string }> = {
  stable:     { label: 'Stable',     className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
  beta:       { label: 'Beta',       className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  internal:   { label: 'Internal',   className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  deprecated: { label: 'Deprecated', className: 'bg-rose-500/10 text-rose-500 border-rose-500/20' },
};
