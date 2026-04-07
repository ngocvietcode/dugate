# AISkillHub Upgrade — Task List

> **Branch**: `ai-skillhub`  
> **Ngày tạo**: 2026-04-07

## Phase 1: Database

- [x] Thêm model `SkillGroup` vào `prisma/schema.prisma`
- [x] Cập nhật comment `Operation.endpointSlug` format mới
- [ ] Chạy `prisma migrate dev --name "add_skill_group_and_new_endpoint_slug_format"`
- [ ] Seed `SkillGroup` record: `{ slug: "document", displayName: "Document Processing", ... }`
- [ ] Viết migration script: cập nhật `Operation.endpointSlug` cũ → format `document:X:Y`

## Phase 2: Registry Refactoring

- [ ] Thêm interface `SkillGroupDef` vào `lib/endpoints/registry.ts`
- [ ] Bọc 6 services hiện tại vào `DOCUMENT_SKILL_GROUP`
- [ ] Đổi export chính: `SERVICE_REGISTRY` → `SKILL_REGISTRY`
- [ ] Export helpers: `getAllSkillGroups()`, `getSkillGroup()`, `getServiceDef()`
- [ ] Cập nhật `getAllEndpointSlugs()` → format slug mới `"document:ingest:parse"`

## Phase 3: Runner Update

- [ ] Cập nhật signature `runEndpoint(serviceSlug, req, groupSlug)`
- [ ] Lookup via `SKILL_REGISTRY[groupSlug].services[serviceSlug]`
- [ ] `endpointSlug` format mới: `"document:ingest:parse"`
- [ ] Error message cập nhật (thay `dugate.vn` → `aiskillhub.vn` nếu cần)

## Phase 4: API Routes

- [ ] Xóa `app/api/v1/ingest/route.ts`
- [ ] Xóa `app/api/v1/extract/route.ts`
- [ ] Xóa `app/api/v1/analyze/route.ts`
- [ ] Xóa `app/api/v1/transform/route.ts`
- [ ] Xóa `app/api/v1/generate/route.ts`
- [ ] Xóa `app/api/v1/compare/route.ts`
- [ ] Tạo `app/api/v1/skills/[group]/[service]/route.ts`
- [ ] Cập nhật middleware.ts nếu có whitelist route cứng

## Phase 5: Middleware & Internal

- [ ] Kiểm tra `middleware.ts` — cập nhật path patterns nếu có `/api/v1/ingest` cứng
- [ ] Kiểm tra `app/api/internal/` routes — cập nhật nếu reference endpoint slug cũ
- [ ] Kiểm tra `lib/settings.ts` — `SERVICE_REGISTRY` references

## Phase 6: UI Rebranding

- [ ] `app/layout.tsx` — title/description metadata → AISkillHub
- [ ] `components/HeaderNav.tsx` — logo text + icon
- [ ] `app/page.tsx` — hero + Skill Groups grid redesign
- [ ] `components/SettingsForm.tsx` — text references DUGate → AISkillHub
- [ ] `app/profiles/page.tsx` — endpoint slug display cập nhật
- [ ] `package.json` — `name` field

## Phase 7: Verification

- [ ] `npm run build` — TypeScript không lỗi
- [ ] Test route mới: `POST /api/v1/skills/document/ingest`
- [ ] Test Profiles page: endpoint slugs hiển thị `document:ingest:parse`
- [ ] Test Operations history: slug format mới
- [ ] Kiểm tra UI trang chủ và HeaderNav

## Notes

- DB migration cần Docker đang chạy (`docker-compose up -d`)
- Các app pages (`/ingest`, `/extract`, ...) cần cập nhật nếu có hard-code URL
