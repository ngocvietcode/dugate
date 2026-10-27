# Thêm một sản phẩm / luồng mới cho workflow `loan-appraisal`

Tài liệu này liệt kê **mọi điểm cần bổ sung** để thêm một sản phẩm vay (`product_code`) hoặc một luồng thẩm định (`flow`) mới. Ví dụ xuyên suốt: sản phẩm `sme`, luồng `FLOW_A`.

Request:

```
process      = loan-appraisal
product_code = sme
flow         = FLOW_A
```

> Nguyên tắc: **sản phẩm và danh mục hồ sơ là dữ liệu (JSON), logic thẩm định là code dùng chung.** Thêm sản phẩm thường chỉ cần sửa JSON; chỉ phải sửa code khi có loại chứng từ, điều kiện hoặc cách tính hoàn toàn mới.

## 1. Mô hình: ba khái niệm tách bạch

| Khái niệm | Là gì | Nằm ở đâu | Quan hệ |
|---|---|---|---|
| **Sản phẩm** (`product_code`) | Mã sản phẩm vay, kèm policy mặc định (ngưỡng DSCR, LTV, hạn mức) | `loan_products.json` | 1 sản phẩm thuộc đúng 1 chương trình |
| **Chương trình checklist** (`program_key`) | Nhóm sản phẩm dùng chung danh mục hồ sơ, khai báo các **luồng** | `checklist_programs.json` | 1 chương trình có nhiều sản phẩm và nhiều luồng |
| **Luồng** (`flow_key`) | Biến thể của danh mục hồ sơ trong một chương trình | `checklist_programs.json` (`flows[]`) | Mức yêu cầu của từng mục được khai **theo luồng** |

`flow` luôn được hiểu **trong phạm vi chương trình của sản phẩm**: `FULL` hợp lệ với `hkd-loan`, nhưng là `INVALID_FLOW` với `sme`; `FLOW_A` ngược lại.

## 2. Việc bắt buộc (không cần sửa code)

Danh sách này đủ để một sản phẩm mới **chạy được** end-to-end.

### 2.1. Khai báo sản phẩm: `loan_products.json`

Thêm một phần tử vào `products`:

```json
{
  "product_code": "sme",
  "name": "Vay Doanh nghiệp vừa và nhỏ (SME)",
  "description": "…",
  "policy": {
    "config_version": "0.1.0",
    "policy_id": "PP-SME-SECURED",
    "policy_version": "0.1.0-draft",
    "minimum_dscr": 1.25,
    "maximum_ltv": 0.7,
    "maximum_amount_vnd": 3000000000,
    "default_tenor_months": 18,
    "scorecard_id": null,
    "scorecard_version": null
  }
}
```

- `product_code`: chữ thường, số, dấu gạch ngang (`^[a-z][a-z0-9-]*$`). Mã này là giá trị client gửi lên.
- Ngưỡng `policy` bị kẹp trong khoảng hợp lệ (xem `POLICY_RANGES` trong `check-set.ts`); ngoài khoảng thì nạp catalog thất bại.
- `scorecard_id` / `scorecard_version`: vẫn nằm trong catalog nhưng không còn được dùng; stage stress test & scorecard đã bỏ khỏi workflow. Giữ `null`.
- `default_product_code` ở đầu file là sản phẩm dùng khi request không truyền `product_code`. Đổi nó là đổi hành vi mặc định của mọi client cũ; **không đổi** khi thêm sản phẩm mới.

### 2.2. Khai báo chương trình và luồng: `checklist_programs.json`

Thêm một chương trình có `product_codes` chứa mã sản phẩm mới:

```json
{
  "program_key": "sme_secured",
  "program_label": "Doanh nghiệp vừa và nhỏ (SME) — vay có TSBĐ",
  "product_codes": ["sme"],
  "flows": [{ "flow_key": "FLOW_A", "flow_label": "FLOW_A: luồng A của SME" }],
  "requirements": {
    "legal_id_card": { "FLOW_A": "REQUIRED" },
    "legal_vneid":   { "FLOW_A": "REQUIRED" }
  }
}
```

Quy tắc (bị kiểm khi nạp, sai thì lỗi ngay):

- `program_key`: `^[a-z][a-z0-9_]*$`. `flow_key`: chữ hoa/số/gạch dưới (`^[A-Z][A-Z0-9_]*$`). **Đặt khóa luồng có tiền tố rõ nghĩa** (`FLOW_A`, không phải `A`), vì `LOAN_FLOWS` là hợp luồng của *mọi* chương trình và rule dùng chung khóa này để lọc phạm vi.
- Một `product_code` chỉ thuộc **một** chương trình.
- Mỗi mục trong `requirements` phải khai **đúng các luồng của chương trình** (thiếu hoặc thừa đều lỗi).
- Giá trị mỗi luồng: `REQUIRED` | `CONDITIONAL` | `NOT_REQUIRED` | `null`. `null` = không sinh dòng ở luồng đó. `CONDITIONAL` chỉ dùng cho mục có `condition_id` trong catalog.
- Mục không có trong `requirements` cũng không sinh dòng. Khuyến nghị khai **đủ mọi mục** của `checklist_catalog.json` (mục chưa quyết định để `null`) để người đọc thấy rõ mục nào bị loại có chủ đích.
- Luồng **đầu tiên** trong `flows` là luồng mặc định (dùng khi request không truyền `flow` hoặc truyền sai ở phần rule; riêng checklist S4 báo `INVALID_FLOW`).

### 2.3. Đồng bộ catalog

Nguồn gốc của các file catalog là `docs/loan-appraisal/spec-v3/03_catalogs/`; bản trong `lib/loan-dossier/catalog/data/` là **bản sao** được kiểm bằng SHA-256.

1. Sửa file ở `docs/loan-appraisal/spec-v3/03_catalogs/`.
2. Chạy `npm run sync:loan-catalogs`.
3. Commit **cả hai** bản. Thiếu một trong hai thì test `catalog-sync` fail. Chạy sync sẽ **xoá** file ở `data/` mà thư mục nguồn không có, nên không tạo file chỉ ở `data/`.

### 2.4. Kiểm chéo sản phẩm ↔ chương trình

`validateProductsAgainstPrograms` (có test) bắt: sản phẩm không có chương trình, sản phẩm thuộc nhiều chương trình, chương trình trỏ tới `product_code` chưa khai. Chạy `npx jest tests/loan-dossier/s4-programs.test.ts`.

### 2.5. Phân khúc phải có segment pack (D-100)

`segment` của sản phẩm chọn **segment pack**, tức logic tính tài chính, policy, khuyến nghị (stage 2–4), qua
`lib/pipelines/workflows/loan-appraisal/segment-packs/registry.ts`. Hiện có `HKD → hkd-secured` và `SME → hkd-secured`
(SME tạm dùng logic HKD, xem 3.7). Sản phẩm thuộc phân khúc chưa có pack (`CORPORATE`, `RETAIL`): **worker không khởi
động** (`validateSegmentPackRegistry` ở `worker.ts`) và `tests/loan-appraisal/segment-packs.test.ts` fail. Không có pack
mặc định. Pack đã dùng được ghi ở `config_snapshot.segment_pack` của mỗi kết quả.

## 3. Việc cần cân nhắc theo yêu cầu nghiệp vụ

### 3.1. Danh mục hồ sơ khác (`checklist_catalog.json`)

Nếu sản phẩm mới yêu cầu **mục** chưa có trong catalog (ví dụ điều lệ công ty, giấy ủy quyền), thêm mục vào `checklist_catalog.json`:

| Trường | Ý nghĩa |
|---|---|
| `item_key` | Khóa mục, duy nhất; dùng trong `requirements` |
| `checklist_group` | Nhóm hiển thị (`legal`, `loan_plan`, `income`, `collateral`, `credit`…) |
| `accepted_doc_type_keys` | Loại chứng từ được chấp nhận (khóa của `doc_types.json`). Mục không có loại chứng từ (dữ liệu từ hệ thống ngoài) bị precheck bỏ qua |
| `substitutes` | Chứng từ thay thế |
| `scope` | `DOSSIER` (một dòng), `PERSON` (mỗi người một dòng), `ASSET` (mỗi tài sản một dòng) |
| `applies_to_roles`, `asset_types` | Áp cho vai trò / loại tài sản nào |
| `condition_id` | Điều kiện để mục áp dụng (xem 3.3); bắt buộc nếu muốn đặt `CONDITIONAL` |
| `validity_days`, `original_or_copy`, `has_count_rule` | Hiệu lực, bản gốc/sao, quy tắc đếm |

Sau khi thêm mục, **mọi chương trình** phải khai mục đó trong `requirements` (có thể `null`), nếu không nạp catalog lỗi. Số mục hiện là 46; thẻ UI và comment còn nhắc "46 mục" bằng chữ nên cần rà.

### 3.2. Loại chứng từ mới (`doc_types.json`)

Cần khi sản phẩm có chứng từ chưa nhận diện được. Có hai mức:

- **LIGHT** (`extraction_level: LIGHT`): chỉ trích vài trường cố định. Khai báo trong `doc_types.json` + `light_extraction.json`. Nhẹ, không cần schema zod.
- **FULL**: bóc tách đầy đủ theo schema. Cần đồng thời:
  1. `doc_types.json`: khai báo loại, kèm `key_facts` (danh mục khóa S1 phải trả, tối đa 5 khóa, `loan_application` tối đa 7).
  2. `doc_schemas/<loại>.schema.json`: JSON schema (chạy `npm run gen:loan-doc-schemas` nếu có sinh tự động).
  3. `lib/loan-dossier/s2/schemas/<loại>.ts`: schema zod, đăng ký ở `s2/schemas/index.ts`.
  4. Nếu loại này là nguồn dữ liệu cho tài chính/đối chiếu: thêm vào `cross_check_matrix.json` (3.4).

Phân loại S1 dùng **một danh mục chung cho mọi sản phẩm**: thêm loại chứng từ làm prompt phân loại dài hơn cho cả sản phẩm cũ. Kiểm tra chất lượng phân loại của HKD sau khi thêm.

### 3.3. Điều kiện mới (`condition_id`)

Mục `CONDITIONAL` cần một điều kiện (ví dụ "có tài sản là bất động sản"). Hiện có 18 điều kiện, cài đặt ở `lib/loan-dossier/s4/conditions-rule.ts` (quy tắc) và `conditions-llm.ts` (ngữ nghĩa, gọi LLM). Điều kiện mới là **code**: thêm `case` và test. Lưu ý các điều kiện đang gắn HKD:

- `loan_amount_over_3_billion` (ngưỡng 3 tỷ cố định) và `household_business_license_required`.
- `conditions-llm.ts` có `HKD_PATTERN` nhận diện loại khách hàng.
- `same_person_commitment_required` dùng `ctx.flow === 'FULL'` làm điều kiện: **luồng của sản phẩm khác không bao giờ khớp** nhánh này. Rà soát nếu SME cần cam kết cùng người.

### 3.4. Đối chiếu chéo (`cross_check_matrix.json`)

Ma trận `field_group × role × nguồn chứng từ` quyết định trường nào được đối chiếu giữa các chứng từ. Chứng từ/vai trò mới muốn được đối chiếu phải được thêm vào đây.

### 3.5. Kiểm tra sơ bộ cho Sale

`dossier_precheck` **đọc danh mục từ chương trình của sản phẩm** (`programForProduct` + `resolveChecklist`), nên danh mục mới tự có hiệu lực. Không cần sửa code. Những điểm cần cân nhắc:

- **Prompt** (`DOSSIER_PRECHECK_PROMPT_TEMPLATE`) trung tính sản phẩm. Nếu sản phẩm cần quy tắc đánh giá riêng (ví dụ đối chiếu điều lệ với người đại diện), đặt qua **prompt override của Profile** (step `dossier_precheck`) gắn với API key của sản phẩm đó; không sửa prompt mặc định để khỏi ảnh hưởng sản phẩm khác.
- **Độ dài prompt và độ trễ.** Prompt tăng theo số mục. Với 36 mục, prompt khoảng 24.000 ký tự và bước này mất ~40 giây (đầu ra ~7.000 token). Chương trình nhiều mục hơn sẽ chậm hơn nữa; `CHECKLIST_CHAR_BUDGET` cắt checklist nếu quá dài (kết quả thiếu mục sẽ bị hạ về `UNCERTAIN`).
- Chương trình có `requirements` rỗng ở mọi mục cho luồng đó → precheck `SKIPPED` ("không có mục checklist nào để kiểm tra").

### 3.6. Rule check: dùng chung, tham số theo sản phẩm

Bộ rule dùng id **chung không phụ thuộc sản phẩm** (`LOAN.*`):

| Id | Nhóm | Loại | Ngưỡng lấy từ |
|---|---|---|---|
| `LOAN.INTAKE.REQUIRED_DOCUMENTS` | Hồ sơ & định danh | Rule engine | checklist S4 |
| `LOAN.CAPACITY.MIN_DSCR` | Năng lực trả nợ | Rule engine | `policy.minimum_dscr` của sản phẩm, hoặc `params.minimum` |
| `LOAN.COLLATERAL.MAX_LTV` | Tài sản bảo đảm | Rule engine | `policy.maximum_ltv`, hoặc `params.maximum` |
| `LOAN.PRODUCT.MAX_AMOUNT` | Phương án & hạn mức vay | Rule engine | `policy.maximum_amount_vnd`, hoặc `params.maximum_vnd` |
| `LOAN.CONSISTENCY.BORROWER_IDENTITY` | Hồ sơ & định danh | Rule LLM | prompt + `threshold` |
| `LOAN.COLLATERAL.OWNER_MATCH` | Tài sản bảo đảm | Rule LLM | prompt + `threshold` |
| `LOAN.PURPOSE.COHERENCE` | Phương án & hạn mức vay | Rule LLM | prompt + `threshold` |

Nhóm (`group`: `DOSSIER`, `CAPACITY`, `COLLATERAL`, `LOAN_PLAN`, `OTHER`) chỉ để trình bày; định nghĩa ở `rule-groups.ts`. Rule không khai báo `group` được suy từ vùng nghiệp vụ trong id (`LOAN.<AREA>.<NAME>`); rule tuỳ chỉnh mặc định vào `OTHER`. Trang kết quả giai đoạn 2 sinh một box cho mỗi rule trong `rule_results`, nên rule thêm ở trang Cấu hình tự có box ở lần chạy sau.

Cách khác nhau theo sản phẩm, **không cần sửa code**:

1. **Ngưỡng deterministic**: đặt ở `policy` của sản phẩm trong `loan_products.json`. Profile ghi đè được bằng tham số `loan_policy`.
2. **Bật/tắt hoặc thu hẹp rule theo sản phẩm**: trong `loan_check_set` của Profile, đặt `products: ["sme"]` (hoặc `flows`) cho rule. Catalog mặc định để `products: []` nghĩa là *áp cho mọi sản phẩm*.
3. **Prompt rule LLM riêng**: override `prompt` của rule trong Profile của sản phẩm.

Chỉ khi cần một **phép so sánh mới** (ví dụ chỉ số khả năng thanh toán của doanh nghiệp) mới phải thêm lớp rule vào `rules.ts`, thêm id vào `DETERMINISTIC_CHECK_IDS` và `buildRuleSet`. Cấu hình **không** tạo được rule engine mới.

**Tương thích id cũ.** Trước đây id có tiền tố `HKD.`. Bảng `LEGACY_CHECK_ID_ALIASES` (trong `check-set.ts`) đổi id cũ sang `LOAN.*` ở mọi điểm đọc, nên Profile đã lưu `loan_check_set` với id cũ vẫn chạy. **Không bao giờ xoá mục khỏi bảng này.** Khi thêm rule mới, dùng tiền tố `LOAN.` và không cần alias.

### 3.7. Tài chính (đã bỏ 5C, stress test và scorecard)

Đánh giá 5C, stress test và scorecard đã bỏ khỏi giai đoạn 2: kết quả thẩm định chỉ dựa trên chỉ số tài chính và bộ rule (engine + LLM). Field `five_c` chỉ còn ở kết quả cũ.

Tầng này **tách theo phân khúc qua segment pack** (D-100, mục 2.5), nhưng hiện chỉ có pack `hkd-secured`: nó đọc doanh thu / lợi nhuận từ `income_sources[]` loại `household_business` của bảng kê thu nhập HKD. Sản phẩm dùng báo cáo tài chính doanh nghiệp (bảng cân đối, báo cáo kết quả kinh doanh) sẽ **không** có doanh thu/lợi nhuận được trích đúng, nên `DSCR` và `LTV` có thể ở trạng thái `INSUFFICIENT_DATA`. Cần một pack riêng (cài `SegmentPack` ở `segment-packs/types.ts`, đăng ký trong `registry.ts`), kèm schema bóc tách FULL cho chứng từ tài chính. Đây là việc code, không phải cấu hình; xem `ARCHITECTURE.md` §9.

## 4. Giao diện

Các chỗ liên quan đã đọc cấu hình, **không cần sửa code** khi thêm sản phẩm trong JSON:

| Chỗ | File | Hành vi |
|---|---|---|
| Ô chọn sản phẩm | `components/loan-appraisal-v2/setup/CaseSetupPanel.tsx` | Liệt kê từ `loan_products.json` |
| Ô chọn luồng | cùng file | Chỉ hiện luồng của chương trình của sản phẩm đã chọn; đổi sản phẩm thì luồng về luồng đầu nếu luồng cũ không còn hợp lệ |
| Mặc định | `app/loan-appraisal-v2/lib/product-options.ts` | `default_product_code` |
| Cấu hình rule/policy | `/loan-appraisal-v2/config`, Profile | Danh sách sản phẩm và luồng lấy từ cùng cấu hình |

Sản phẩm và luồng bị **khóa** khi hồ sơ đã có kết quả. Giao diện đọc JSON trực tiếp (không qua zod) để không kéo zod vào bundle trình duyệt.

Cần rà thủ công: các văn bản cố định nhắc "HKD", "46 mục", "FULL/FAST/SIMPLE" trong mô tả (`registry.ts`, `app/profiles/page.tsx`, README).

## 5. Đăng ký và tài liệu API

- `lib/endpoints/registry.ts`: mô tả tham số `product_code` và `flow` của workflow `loan-appraisal`. Cập nhật danh sách sản phẩm và luồng cho đúng.
- Docs API ngoài (`docs-site/`) nếu có liệt kê sản phẩm.
- Ghi quyết định vào `docs/loan-appraisal/spec-v3/IMPLEMENT.md` (mã `D-xx`).

## 6. Kiểm thử

| Việc | Cách |
|---|---|
| Catalog nạp được, kiểm chéo sản phẩm ↔ chương trình | `tests/loan-dossier/s4-programs.test.ts` |
| Đồng bộ catalog docs ↔ code | `tests/loan-dossier/catalog-sync.test.ts` (chạy `npm run sync:loan-catalogs` trước) |
| `getLoanProduct`, policy, ngưỡng ghi đè | `s4-programs.test.ts` |
| Rule dùng chung và alias id cũ | `tests/loan-appraisal/check-set-scope.test.ts` |
| UI chọn sản phẩm và luồng | `tests/loan-appraisal-v2/product-options.test.ts` |
| Chạy end-to-end với bộ hồ sơ thật | Gửi `process=loan-appraisal&product_code=<mã>&flow=<luồng>` và kiểm tra checklist, precheck, rule |

Chạy typecheck: `npx tsc --noEmit`. Khi chạy jest cục bộ nhớ giới hạn thư mục (`npx jest --roots "<rootDir>/tests" -- <đường dẫn>`) vì repo có `.worktrees/` và `.kilo/worktrees/` cũng chứa test.

## 7. Danh sách kiểm tra (checklist) khi thêm sản phẩm

**Bắt buộc**
- [ ] `loan_products.json`: thêm sản phẩm + policy (ở `docs/.../03_catalogs/` rồi sync).
- [ ] `checklist_programs.json`: thêm chương trình, `product_codes`, `flows` (khóa có tiền tố rõ nghĩa), `requirements` cho mọi mục.
- [ ] `npm run sync:loan-catalogs`; commit cả bản docs lẫn bản `lib/`.
- [ ] `npx tsc --noEmit` và test catalog xanh.
- [ ] Cập nhật mô tả `product_code`/`flow` ở `registry.ts`.
- [ ] Phân khúc của sản phẩm có segment pack (`segment-packs/registry.ts`, mục 2.5); `tests/loan-appraisal/segment-packs.test.ts` xanh.

**Theo nghiệp vụ**
- [ ] Mục checklist mới (`checklist_catalog.json`) và mọi chương trình khai mục đó.
- [ ] Loại chứng từ mới (`doc_types.json`, schema OCR) và kiểm tra lại phân loại của sản phẩm cũ.
- [ ] Điều kiện mới (`conditions-rule.ts` / `conditions-llm.ts`); rà các điều kiện gắn HKD (3.3).
- [ ] Ma trận đối chiếu chéo (`cross_check_matrix.json`).
- [ ] Prompt kiểm tra sơ bộ riêng qua Profile (nếu cần).
- [ ] Tham số rule / `products[]` trong `loan_check_set` của Profile.
- [ ] Segment pack riêng (code) nếu cách tính tài chính / policy / khuyến nghị khác HKD.

**Trước khi bàn giao**
- [ ] Chạy hồ sơ thật qua cả hai giai đoạn: kiểm tra sơ bộ (giai đoạn 1), rồi checklist, đối chiếu, rule (giai đoạn 2).
- [ ] Hồ sơ HKD cũ vẫn cho kết quả như trước (hồi quy: 43 mục luồng FULL).
- [ ] Ghi `D-xx` vào `IMPLEMENT.md`.

## 8. Câu hỏi mở (open questions)

Các điểm dưới đây **chưa quyết định**, sẽ xử lý sau khi có kết quả test với hồ sơ thật. Không làm trước để tránh đổi thiết kế hai lần.

### OQ-1. Mô hình pháp nhân (khách hàng vay là doanh nghiệp) — rủi ro cao nhất cho SME

Mô hình thực thể hiện tại là **người tự nhiên**:

- S3 (`lib/loan-dossier/s3/unmapped.ts`) chỉ gom `party_type === 'INDIVIDUAL'` vào `role_registry`. Bên `ORGANIZATION` không thành "người" trong Customer 360.
- Mục checklist `scope: PERSON` sinh dòng cho từng cá nhân. Công ty vay sẽ không có dòng nào, còn người đại diện pháp luật mới là cá nhân.
- Ma trận đối chiếu chéo (`cross_check_matrix.json`) và UI "Người & tài sản" cũng giả định thực thể là người.

Cần quyết định khi có kết quả test:

1. Coi **người đại diện pháp luật** là `borrower` và công ty chỉ là thuộc tính (thay đổi nhỏ nhất, nhưng mất đối chiếu mã số thuế / số đăng ký).
2. Hoặc mô hình hóa `ORGANIZATION` thành thực thể riêng trong `role_registry` / `customer_360` (thay đổi lớn: S3, S4, S5, UI).

Ảnh hưởng nếu chưa giải quyết: mục `PERSON` của SME có thể báo thiếu sai, đối chiếu tên khách hàng vay có thể so tên công ty với tên người.

### OQ-2. Chương trình `sme_secured` hiện là khung

`checklist_programs.json` đang dùng mức yêu cầu của luồng `FULL` của HKD làm điểm khởi đầu cho `FLOW_A` (43 dòng). Danh mục thật của SME cần nghiệp vụ chốt: mục nào bắt buộc, mục nào có điều kiện, mục mới. Cho tới lúc đó kết quả checklist của SME **không có giá trị nghiệp vụ**.

### OQ-3. Policy SME

`PP-SME-SECURED` đang dùng tạm ngưỡng của HKD (DSCR 1,25; LTV 70%; hạn mức 3 tỷ) và có `policy_version` `0.1.0-draft`. Cần Credit Risk cung cấp ngưỡng thật.

### OQ-4. Tài chính doanh nghiệp

Xem 3.7. Quyết định có dùng chung chiến lược HKD hay viết chiến lược theo báo cáo tài chính doanh nghiệp.
