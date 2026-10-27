# Test — Chiến lược kiểm thử

> **Nền v2 (D-32, 2026-10-16):** chỉ áp dụng phần được liệt kê ở [cross_cutting/v2_integration.md](v2_integration.md) §1; phần gắn với W1/W2 không làm.

## 1. Ràng buộc thực tế của repo (đã đọc)

| Sự thật | Hệ quả |
|---|---|
| `jest.config.js`: `testEnvironment: 'node'`, `testMatch: ['**/tests/**/*.test.ts']` | Test chỉ là `.ts` trong `tests/`. **Không** có test `.tsx`, không có jsdom |
| `package.json` không có `@testing-library/*`, `jsdom`, `playwright` | Không test render component. Logic UI nằm ở hàm thuần trong `lib/loan-dossier/ui/` hoặc `lib/loan-dossier/confirmation/` |
| Test dùng `ts-jest` với `tsconfig.jest.json` | Dùng được alias `@/` |
| Mọi test DB hiện có đều mock `@/lib/db` | Luồng này không có DB (D-01), nên không cần mock DB; workflow được test với `WorkflowContext` giả |

Không thêm thư viện test mới trong Sprint 1–2. Muốn test component → xin duyệt (OQ-13).

## 2. Rule

| ID | Rule |
|---|---|
| **TS-R01** | Mỗi module có đúng 1 file test, tên `tests/loan-dossier/<tên-module>.test.ts`, đúng đường dẫn nêu trong task. Ngoại lệ: thành phần React (`.tsx`) không có file test riêng vì môi trường là `node` (§1); chúng được kiểm bằng `tsc`, `next lint`, test quét mã (T-U1-12, T-SEC-03) và test của v2 khi sửa thành phần v2 (`npx jest tests/loan-appraisal-v2`) |
| **TS-R02** | Viết test **trước**, chạy thấy đỏ, rồi viết code cho tới khi xanh. Ghi kết quả đỏ/xanh vào `IMPLEMENT.md` khi task không tầm thường |
| **TS-R03** | Hàm thuần được test trực tiếp. Phần I/O (queue, model, storage, mạng) đi qua **port** và test dùng bản giả. Không gọi model thật, không cần Postgres/Redis để chạy `npx jest tests/loan-dossier` |
| **TS-R04** | Workflow (T-RUN-03, T-RUN-04) test bằng `WorkflowContext` giả: `filesData` trỏ tới file tạm, `pipelineVars` tiêm được, `completeWorkflow`/`failWorkflow`/`updateProgress` được mock để ghi lại lời gọi. Kiểm luồng thật qua route + worker là nhiệm vụ của T-TEST-03 |
| **TS-R05** | Fixture là dữ liệu giả (S-R11). Đặt ở `tests/loan-dossier/fixtures/`, mỗi file < 20 KB, không binary lớn. PDF/ảnh mẫu sinh bằng mã trong test (T-TEST-01), không commit file thật |
| **TS-R06** | Mỗi AC trong spec có ≥ 1 test mang mã AC trong tên (`it('S4-AC03: …')`). T-TEST-02 kiểm điều này tự động |
| **TS-R07** | Test tất định: không `Date.now()`/`Math.random()` thật (tiêm đồng hồ/sinh số), không phụ thuộc thứ tự chạy |
| **TS-R08** | Không `it.skip`/`xit` trong code đã hoàn thành |

## 3. Task

### T-TEST-01 — Bộ dựng fixture giả
- Depends: T-S2-02
- Files: `tests/loan-dossier/fixtures/build.ts`, `tests/loan-dossier/fixtures-build.test.ts`
- Refs: TS-R05, S-R11
- Làm: Hàm dựng dữ liệu giả hợp lệ theo schema: `makeEvidence(docTypeKey, overrides)`, `makeParty(overrides)`, `makeAsset(overrides)`, `makePng(w,h)`, `makePdf(pages)` (PDF tối thiểu tạo bằng chuỗi byte, không thư viện). Mọi giá trị là dữ liệu giả cố định. Nền v2 (D-32): bỏ `makeConfirmation`, `makeFieldEdit` vì form xác nhận và bản vá không áp dụng.
- DoD:
  - test: mỗi `makeEvidence` cho 27 loại `FULL` parse qua schema zod của T-S2
  - test: `makePng` có magic `89 50 4E 47`; `makePdf(2)` bắt đầu `%PDF-`
  - test: không giá trị nào trong fixture khớp mẫu số định danh thật (chỉ `000000000000`, `0000000000`…)
- Verify: `npx jest tests/loan-dossier/fixtures-build.test.ts`

### T-TEST-02 — Mọi AC có test
- Depends: các file spec đã xong
- Files: `tests/loan-dossier/spec-ac-coverage.test.ts`
- Refs: TS-R06
- Làm: Đọc `docs/loan-appraisal/spec-v3/**/*.md`, lấy mọi mã `S\d-AC\d+`, `U\d-AC\d+`; đọc mọi `tests/loan-dossier/*.test.ts`, tìm mã đó trong tên test. Nền v2 (D-32): chỉ đòi AC của S1–S5 (bỏ `S6-AC*`, `U*-AC*`). Báo thiếu. Cờ `AC_COVERAGE=report` chỉ in danh sách thiếu mà không fail; mặc định fail.
- DoD:
  - test: bộ quét tìm đúng mã trong chuỗi mẫu (kiểm chính nó)
  - test: mã AC có trong spec nhưng không có trong test → bị báo (dùng thư mục tạm)
  - ở cuối Sprint: không còn mã thiếu
- Verify: `npx jest tests/loan-dossier/spec-ac-coverage.test.ts`

### T-TEST-03 — Smoke test với hạ tầng thật (chạy tay)
- Depends: toàn bộ task code
- Files: `docs/loan-appraisal/spec-v3/SMOKE.md`
- Refs: S-R06, A-R07
- Làm: Kịch bản chạy tay trên môi trường có Postgres + Redis + worker (`npm run dev`, `npm run worker:dev`): bật hai endpoint cho 1 Profile, gửi W1 với 3 file giả, đọc `OcrOutput`, sửa 1 giá trị trên giao diện, điền form, gửi W2, đọc `CheckOutput`; lặp lại với `AUTO` khi Profile bật và tắt. Mỗi bước có "Kết quả mong đợi" đo được.
- DoD:
  - kịch bản có ≥ 10 bước, mỗi bước có kết quả mong đợi
  - có bước kiểm `Operation.pipelineJson` của W1/W2 không chứa chuỗi `NGUYEN VAN A` (D-06)
  - có bước kiểm sau `FILE_EXPIRY_HOURS` file của W1/W2 đã bị dọn
  - có bước kiểm không có bảng mới tên `Loan…` trong DB
  - người làm ghi kết quả thật vào `IMPLEMENT.md`; không điền khi chưa chạy
- Verify: `node -e "process.exit(require('fs').statSync('docs/loan-appraisal/spec-v3/SMOKE.md').size>0?0:1)"` (chỉ kiểm file tồn tại; **kết quả chạy tay do người xác nhận**)

### T-TEST-04 — Toàn bộ test của luồng
- Depends: mọi task code
- Files: —
- Refs: TS-R02, TS-R08
- Làm: Chạy đủ các cổng: `npx jest tests/loan-dossier`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`.
- DoD: cả 4 lệnh exit 0.
- Verify: `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
