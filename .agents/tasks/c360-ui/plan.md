# Plan: Customer 360 gọn, đủ, dễ ra quyết định (giao diện, D-113)

Nhánh: `codex/c360-ui`, tách từ `feat/c360-decision` (đã có view-model). Làm trong worktree `D:\Projects\dugate-wt\c360-ui`.
KHÔNG commit ngoài nhánh này. KHÔNG sửa file ngoài danh sách Files. Comment tiếng Việt, theo phong cách file xung quanh.
Kiểm: `npx tsc --noEmit`; `npx jest tests/loan-appraisal-v2 --ci`. Repo không có `@testing-library` / `jsdom` (D-15): logic mới phải ở hàm
thuần trong `app/loan-appraisal-v2/lib/`, component chỉ hiển thị. Test tối thiểu (yêu cầu người dùng).

## Mục tiêu

Tab "Hồ sơ khách hàng" của giai đoạn 2 hiện mở bằng một khối dài: thẻ người / tài sản, chi tiết mở sẵn, người thẩm định phải tự đọc để tìm
điểm bất thường. Đổi thành **3 tầng, đọc từ trên xuống là ra quyết định**:

1. **Dải tóm tắt** (1 hàng, 4 ô) — trả lời "vay gì, của ai, trả bằng gì, đảm bảo bằng gì".
2. **Cần chú ý** — mọi điểm phải xử lý trước khi quyết định, nặng trước.
3. **Chi tiết** — bảng gọn nguồn thu, hộ kinh doanh; thẻ người / tài sản hiện có giữ nguyên nhưng **thu gọn mặc định**.

## Sự thật từ code (đã đọc)

- View-model có sẵn, KHÔNG viết lại: `buildDecision360(result, summary, claims, docLabel)` ở `app/loan-appraisal-v2/lib/decision-360.ts`
  trả `{ loan, borrower, counts, income: { monthlyTotal, lines, unevidenced }, businesses, attention }`; `attention` đã xếp danger → warning → info.
  Test: `tests/loan-appraisal-v2/decision-360.test.ts`.
- `summary` = `buildCustomer360(...)` (`customer360-view.ts`), `claims` = `buildClaimsSummary(...)` (`claims-view.ts`): cả hai đã được tính trong
  `components/loan-appraisal-v2/appraisal/Customer360Panel.tsx` bằng `useMemo`; dùng lại đúng hai biến đó, không tính lần hai.
- `docTypeLabelOf` (`app/loan-appraisal-v2/lib/classification-view.ts`) cho nhãn loại chứng từ; `formatCurrencyVnd` (`app/loan-appraisal-v2/lib/format.ts`) cho tiền.
- UI kit: `components/loan-appraisal-v2/ui/{Card,Badge,Disclosure,DataTable,KeyValue}.tsx`, màu theo `toneClasses.ts` (`TONE_BOX`). Mẫu ô số: `appraisal/MetricGrid.tsx`.
- `result.profile_360` vắng ở kết quả cũ → `buildDecision360` trả `loan = null`, `income.lines = []`, `businesses = []`: các ô / bảng tương ứng ẩn,
  không hiện ô rỗng.

## Bước

- [ ] 1. **`components/loan-appraisal-v2/appraisal/Decision360Card.tsx`** (mới), props `{ decision: Decision360 }`:
      - **Dải tóm tắt** `grid sm:grid-cols-2 xl:grid-cols-4`, mỗi ô cùng kiểu `MetricGrid`:
        - *Khoản vay*: số đề nghị (to), dòng nhỏ "đề xuất … · … tháng · …%/năm"; `loan.disputed` khác rỗng → Badge danger "Tranh chấp".
        - *Thu nhập / tháng*: `income.monthlyTotal` (to); dòng nhỏ "`lines.length - unevidenced`/`lines.length` nguồn có chứng từ".
        - *Hộ kinh doanh*: tên + số GCN của đơn vị đầu; > 1 đơn vị thì "+n"; Badge success "Chủ hộ đã xác minh" / warning "Chưa xác minh chủ hộ".
        - *Người & tài sản*: "`counts.people` người · `counts.collateral` TSBĐ"; khách vay `borrower` ở dòng nhỏ.
      - **Cần chú ý** (`attention`): tiêu đề "Cần chú ý (N)"; mỗi dòng: Badge theo `severity` (danger = "Phải xử lý", warning = "Cần soát",
        info = "Lưu ý"), `subject` đậm, `title`, `detail` mờ. Hiện 5 dòng đầu, phần còn lại trong `Disclosure` "Xem thêm n điểm".
        Rỗng → hộp `TONE_BOX.success` "Không có điểm cần chú ý".
      - **Nguồn thu** (`income.lines`, ẩn khi rỗng): bảng 5 cột Loại · Của ai · Hộ kinh doanh · Số tiền/tháng · Chứng từ (✓ / "chỉ lời khai").
        Dòng tổng ở cuối.
      - **Hộ kinh doanh** (`businesses`, ẩn khi rỗng): bảng Tên · Số GCN · Ngành · Chủ hộ · Xác minh · Chứng từ (chip theo `documents`).
- [ ] 2. **`Customer360Panel.tsx`**: tính `decision = useMemo(() => buildDecision360(result, summary, claims, docTypeLabelOf), [...])`, render
      `<Decision360Card decision={decision} />` ngay sau `CardHeader`, TRƯỚC khối "Khoản vay" cũ. Bỏ khối "Khoản vay (theo giấy đề nghị vay)"
      cũ khi `decision.loan` khác null (dải tóm tắt đã có; mục đích vay và thu nhập khai chuyển vào một `Disclosure` "Chi tiết đơn vay").
      Badge "điểm cần chú ý" ở `CardHeader` lấy `decision.attention.filter(severity !== 'info').length`.
- [ ] 3. **Thu gọn chi tiết**: trong `PersonItem`, `Disclosure` "Chi tiết từ chứng từ" bỏ `defaultOpen`, chỉ mở sẵn khi người đó có
      `alerts` hoặc `notes.warnings` khác rỗng. Thêm hàm thuần `shouldOpenDetail(p, notes)` ở `customer360-view.ts` để test.
- [ ] 4. **Test tối thiểu**: 1 case cho `shouldOpenDetail` (có cảnh báo → true, không → false) thêm vào `tests/loan-appraisal-v2/decision-360.test.ts`.
- [ ] 5. **Kiểm** `npx tsc --noEmit` và `npx jest tests/loan-appraisal-v2 --ci`; ghi kết quả vào `.agents/tasks/c360-ui/verification.md`.
      Commit trên `codex/c360-ui` với message `feat(loan-appraisal-v2): decision-first Customer 360 (D-113)`.

## Không làm

- Không đổi backend, view-model `decision-360.ts` (trừ khi thiếu trường: ghi vào verification.md thay vì sửa), `buildCustomer360`, API.
- Không thêm thư viện. Không dùng `localStorage`. Không log giá trị.
