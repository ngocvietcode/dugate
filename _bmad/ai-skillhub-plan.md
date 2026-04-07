# AISkillHub — Nâng cấp Platform từ DUGate

> **Branch**: `ai-skillhub`  
> **Ngày tạo**: 2026-04-07  
> **Trạng thái**: Đang thực hiện

## Tổng quan

**DUGate** hiện tại là một Document Understanding API Gateway với 6 endpoint cứng (ingest, extract, analyze, transform, generate, compare).

Mục tiêu nâng cấp lên **AISkillHub** là tái kiến trúc platform thành một **hệ thống Skills có thể mở rộng động**, trong đó:
- **Document (6 endpoints hiện tại)** chỉ là một **Skill Group** (nhóm kỹ năng xử lý tài liệu)
- Có thể thêm các Skill Group mới (VD: `data`, `code`, `media`, `search`...) mà không cần thay đổi core engine
- Mỗi Skill Group có thể có nhiều **Skills** (tương đương sub-case hiện tại)
- Pipeline Engine, Auth, Operation tracking giữ nguyên hoàn toàn

## Quyết định đã xác nhận

| # | Quyết định | Kết quả |
|---|------------|---------|
| 1 | URL scheme | **Không backward compat** → chuyển hoàn toàn sang `/api/v1/skills/[group]/[service]` |
| 2 | Database | **Tạo bảng `SkillGroup`** trong DB |
| 3 | Skill Groups ban đầu | **Chỉ `document`** — các group khác để sau |
| 4 | endpointSlug migration | **Migration sạch** — cập nhật tất cả record cũ sang format `document:X:Y` |

---

## Proposed Changes

### 1. Database Schema

**[MODIFY] prisma/schema.prisma**
- Thêm model `SkillGroup` (slug, displayName, description, icon, color, enabled, order)
- Cập nhật comment `Operation.endpointSlug`: format mới `"document:ingest:parse"`

**Migration**
- `prisma migrate dev --name "add_skill_group_and_new_endpoint_slug_format"`
- Seed record: `SkillGroup { slug: "document", displayName: "Document Processing", ... }`

**Migration script endpointSlug**
- Cập nhật tất cả `Operation.endpointSlug` cũ: `"ingest:parse"` → `"document:ingest:parse"`

---

### 2. Registry Refactoring

**[MODIFY] lib/endpoints/registry.ts**

Thêm interface `SkillGroupDef`:
```typescript
export interface SkillGroupDef {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  services: Record<string, ServiceDef>;
}
```

Đổi export chính:
```
// Trước
SERVICE_REGISTRY['ingest'] → ServiceDef

// Sau
SKILL_REGISTRY['document'].services['ingest'] → ServiceDef
```

Export helpers mới:
- `getAllSkillGroups()` — danh sách tất cả groups
- `getSkillGroup(slug)` — lấy 1 group
- `getServiceDef(groupSlug, serviceSlug)` — lấy service definition
- `getAllEndpointSlugs()` — cập nhật format slug mới

---

### 3. Endpoint Runner

**[MODIFY] lib/endpoints/runner.ts**
- Signature: `runEndpoint(serviceSlug, req, groupSlug = 'document')`
- Lookup: `SKILL_REGISTRY[groupSlug].services[serviceSlug]`
- `endpointSlug` format: `"document:ingest:parse"` (group:service:subcase)

---

### 4. API Routes

**[DELETE]** Xóa 6 route cũ:
- `app/api/v1/ingest/route.ts`
- `app/api/v1/extract/route.ts`
- `app/api/v1/analyze/route.ts`
- `app/api/v1/transform/route.ts`
- `app/api/v1/generate/route.ts`
- `app/api/v1/compare/route.ts`

**[NEW]** `app/api/v1/skills/[group]/[service]/route.ts`
```typescript
export async function POST(req, { params }) {
  return runEndpoint(params.service, req, params.group);
}
```

URL mới: `/api/v1/skills/document/ingest`, `/api/v1/skills/document/extract`, ...

---

### 5. UI Rebranding

**[MODIFY] app/layout.tsx**
- title: `"AISkillHub — AI Skill Platform"`
- description: mô tả mới về platform skills

**[MODIFY] components/HeaderNav.tsx**
- Logo: `dugate` → `AISkillHub`
- Icon: `FileText` → `BrainCircuit`

**[MODIFY] app/page.tsx**
- Hero: "AISkillHub — Nền tảng AI Skill cho Doanh nghiệp"
- Grid: Skill Groups thay vì 6 endpoint cứng
- Document Group card → expand ra 6 skills bên trong

**[MODIFY] package.json**
- `name`: `"dugate"` → `"ai-skillhub"`

---

## Verification Plan

### Automated
- `npm run build` — TypeScript compile không lỗi
- Test POST `/api/v1/skills/document/ingest` → 202 Accepted
- Test Profiles page slug display

### Manual
- Kiểm tra hero section, Skill Groups grid
- Kiểm tra HeaderNav: logo AISkillHub
- Kiểm tra Operations history: slug format mới
