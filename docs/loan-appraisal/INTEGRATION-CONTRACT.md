# JSON tích hợp hồ sơ vay: Contract 5.2

Đặc tả của `dugate.loan-appraisal.integration`, `schema_version = "5.2"`. Dành cho hệ thống ngoài nhận kết quả thẩm định qua
`GET /api/v1/operations/{id}?view=integration`, `GET /api/v1/operations/{id}/download?view=integration` và webhook `SUCCEEDED`.

> **5.2 so với 5.1 (thay đổi MINOR, D-101).** Thêm `financials[].review?: true`: chỉ số đã tính được nhưng có đầu vào đọc với độ tin cậy
> thấp, cần rà soát trước khi dùng (cùng tên cờ `review` như ở trường của `documents`). Vắng = mọi đầu vào đã chấp nhận. Consumer 5.1 bỏ qua
> field không biết nên không vỡ. Cùng đợt, rule engine trả `REVIEW` (thay vì `PASS`) khi chỉ số nó so sánh mang cờ này.
>
> **5.1 so với 5.0 (thay đổi MINOR).** Thêm `extractions[]` (kết quả OCR theo chứng từ, **bắt buộc**). Các khối `parties`, `assets`, `documents`,
> `findings` trở thành **tuỳ chọn**: giai đoạn 2 hiện tạm tắt các bước kiểm tra hồ sơ (Customer 360, checklist, đối chiếu chéo, master data) nên
> các khối này vắng mặt. Khi các bước đó được bật lại, hoặc với kết quả cũ đã có dữ liệu, chúng xuất hiện như mô tả ở mục 4.
> Consumer 5.0 đọc `parties`/`documents` phải xử lý trường hợp vắng mặt.

**Nguồn duy nhất của contract là `lib/pipelines/workflows/loan-appraisal/integration-contract.ts`.** Kiểu TypeScript, kiểm tra runtime
(`IntegrationPayloadSchema.safeParse`) và JSON Schema công bố (`integrationJsonSchema()`) đều sinh từ file đó. Tài liệu này giải thích
ý đồ; nếu có chỗ lệch, code đúng.

## 1. Mục tiêu

- **Chỉ kết quả cuối** của bộ hồ sơ. Không có thông tin tiến trình (state, stage, audit, cấu hình), không có kết quả giai đoạn 1
  (phân loại, kiểm tra sơ bộ), không có evidence (`evidence_id`, `found_in`, `sources`...).
- **Nhỏ.** Hồ sơ mẫu (1 khách hàng): kết quả đầy đủ 143,6 KB (khi còn đủ các bước kiểm tra hồ sơ), payload 3.1 khoảng 68 KB, 4.0 khoảng 38 KB,
  5.0 khoảng 7,7 KB; **5.1 hiện khoảng 4,4 KB** (kết quả lưu 23,1 KB).
- **Bền.** Thêm rule engine, rule LLM, rule Agent, chỉ số, chứng từ hay một phân khúc khách hàng mới không đổi cấu trúc.

## 2. Nguyên tắc (bắt buộc với người sửa code và consumer)

1. **Cấu trúc đứng yên, dữ liệu thay đổi.** Rule, chỉ số, chứng từ, bên liên quan đều là mảng phần tử cùng hình dạng. Không dùng id
   nghiệp vụ làm tên khóa JSON. Thêm hay bớt phần tử không đổi schema.
2. **Enum đóng, văn bản mở.** Consumer rẽ nhánh theo `outcome`, `severity`, `code`, `status`, `kind`. `message` chỉ để hiển thị.
3. **Mỗi sự thật một lần.** Họ tên và số định danh chỉ ở `parties`; chứng từ cần bổ sung chỉ ở `documents`; kết quả kiểm tra chỉ ở `checks`.
   Nơi khác tham chiếu bằng khóa (`party-1`, `asset-1`, `item_key`, `checks[].id`).
4. **Vắng mặt nghĩa là không áp dụng.** Không dùng `null` giữ chỗ. "Không biết" được biểu diễn bằng giá trị enum (`INSUFFICIENT_DATA`, `MISSING`).
5. **Phần riêng theo phân khúc nằm ở `extensions`**, mỗi namespace có version riêng. Khung không đổi.
6. **Phiên bản hai tầng.** `schema_version` là cấu trúc (MAJOR đổi nghĩa là phá vỡ). `case.profile.catalog` là phiên bản bộ rule và
   danh mục chứng từ, đổi tự do và không phá vỡ.

## 3. Quy tắc phiên bản

| Thay đổi | Mức | Consumer phải làm gì |
|---|---|---|
| Thêm field tùy chọn | MINOR (5.1) | Bỏ qua field không biết |
| Thêm giá trị enum (`kind`, `segment`, `outcome`...) | MINOR | **Coi giá trị lạ là `REVIEW`**, không được lỗi (`UNKNOWN_VALUE_POLICY`) |
| Thêm rule / chỉ số / chứng từ / mã `code` | Không đổi schema (đổi `catalog`) | Không phải làm gì |
| Đổi nghĩa, đổi kiểu, xóa field | MAJOR (6.0) | Chuyển sang phiên bản mới |

JSON Schema dùng `additionalProperties: false` ở mọi object. Đó là để **lỗi của builder lộ ra khi chạy test**, không để field lạ lọt
ra consumer mà không ai biết. Consumer **không** nên bật chế độ strict khi kiểm tra; nên chấp nhận field lạ.

## 4. Cấu trúc

```jsonc
{
  "schema": "dugate.loan-appraisal.integration",
  "schema_version": "5.2",
  "case":     { "id", "completed_at?", "profile": { "segment": "HKD|SME|CORPORATE|RETAIL", "product", "product_name?", "flow?", "catalog": { "checks", "documents" } } },
  "decision": { "status", "recommendation", "suggested_amount_vnd?", "suggested_tenor_months?", "route", "required_role?", "review_required",
                "ready_for_handover?", "reason_codes[]", "conditions?[{code,message?}]", "covenants?[]" },
  "extractions": [ { "doc", "file", "instance?", "pages?[from,to]", "status": "SUCCESS|ERROR", "code?", "schema_version?", "duplicate?", "data?" } ],  // OCR
  // --- các khối dưới đây TUỲ CHỌN: đến từ các bước kiểm tra hồ sơ, vắng khi các bước đó đang tắt ---
  "parties?":  [ { "id": "party-1", "type": "PERSON|ORGANIZATION", "roles[]", "name?", "identifiers?[{type,value}]", "relations?[{type,party}]", "fields?[]" } ],
  "assets?":   [ { "id": "asset-1", "type", "owners?[party]", "usage?[]", "identifiers?[{type,value}]", "fields?[]" } ],
  "documents?": { "readiness", "completeness_percent", "required_present", "required_total",
                 "by_group[{group,required,done,missing,needs_review,percent?}]",
                 "items[{key,group,status,required,party?,asset?,code?,action?,substituted_by?}]",
                 "records[{doc,item?,party?,asset?,fields[]}]",
                 "issues[{kind,file,doc?,message?}]" },
  "findings?": [ { "kind": "DISCREPANCY|LOGIC", "field", "status?", "severity", "review?", "code?", "party?", "asset?", "values?[{doc,value}]", "message?" } ],
  "financials": [ { "metric", "value?", "unit", "status", "conflict?", "review?" } ],
  "checks":   [ { "id", "ver", "kind": "ENGINE|LLM|AGENT|EXTERNAL", "group", "outcome", "severity", "code?", "party?", "asset?", "measure?", "confidence?", "message?", "exception?" } ],
  "checks_summary": { "status", "policy?", "total", "by_outcome[{outcome,count}]" },
  "exceptions?": [ "<checks[].id>" ],
  "notes?":   [ { "kind": "RISK|SYSTEM", "text" } ],
  "extensions?": { "<namespace>": { "version", "data" } },
  "assessment?": { },   // chỉ khi include=narrative
  "labels?":     { }    // chỉ khi include=labels
}
```

### 4.1. `checks[]`: một hình dạng cho mọi loại kiểm tra

- `outcome` (6 giá trị đóng): `PASS`, `FAIL`, `REVIEW`, `INSUFFICIENT_DATA`, `NOT_RUN`, `NOT_APPLICABLE`. **Đây là thứ duy nhất consumer nên rẽ nhánh theo.**
- `kind` chỉ cho biết cách thực thi. Consumer không cần phân nhánh theo `kind`.
- Kiểm tra đạt (`PASS`) gọn nhất: không `message`, không `code`. Rule engine vẫn có `measure` (ngưỡng và giá trị) để thấy căn cứ.
- `measure` chỉ rule engine. `confidence` chỉ LLM và Agent.
- `code` là mã kết quả ổn định. Rule LLM / Agent **chỉ được chọn mã trong `outputs.codes` đã khai báo** cho rule; mã lạ bị hạ `REVIEW` và gán `UNKNOWN_CODE`.
- `message` là diễn giải tự do của model, chỉ để hiển thị. Prompt yêu cầu không lặp lại họ tên hay số định danh.

### 4.2. `extractions` và `documents`

- `extractions[]` là kết quả OCR theo từng chứng từ: `doc` (khóa loại chứng từ), `file`, `status`, và `data` giữ đúng cấu trúc của danh mục chứng từ
  (theo `doc` + `schema_version`) với trường rỗng đã bị bỏ. Không có `evidence_id`, độ tin cậy từng trường hay trang nguồn. Thêm loại chứng từ
  mới không đổi contract.
- `documents` (tuỳ chọn, chỉ khi bước checklist chạy): `items[]` chỉ chứa mục không phải `NOT_APPLICABLE` và hoặc bắt buộc hoặc đang có vấn đề. Tổng quan đầy đủ nằm ở `by_group`.
- Danh sách chứng từ cần bổ sung = `items` có `status` ∈ {`MISSING`, `NEEDS_RESCAN`, `NEEDS_REVIEW`}. `decision` không chép lại.
- `records[]` là dữ liệu đã hợp nhất theo chứng từ (giá trị cuối, không nguồn). Họ tên và số định danh nằm ở `parties`, không lặp ở đây trừ khi xung đột.
  Trường `MISSING` không xuất hiện.

### 4.3. `parties` và `assets`

`parties` thay cho "người" của hộ kinh doanh để bao được tổ chức: `type` = `PERSON` hoặc `ORGANIZATION`, `roles[]` mở
(`borrower`, `co_borrower`, `collateral_owner`, `legal_representative`, `beneficial_owner`...), `identifiers[]` theo loại
(`NATIONAL_ID`, `TAX_CODE`, `BUSINESS_REG`...), `relations[]` (`SPOUSE`, `PARENT_COMPANY`...).

### 4.4. `financials`

Mảng `{ metric, value, unit, status }`. Chỉ số mới (ICR, D/E, current ratio...) là phần tử mới, không phải field mới.

## 5. Cách thêm... mà không phá contract

| Việc | Làm gì | Schema đổi? |
|---|---|---|
| Rule engine mới | Thêm lớp trong `rules.ts` + id vào `DETERMINISTIC_CHECK_IDS` + catalog | Không |
| Rule LLM mới | Thêm vào cấu hình, **khai báo `outputs.codes`** | Không |
| Rule Agent | Thêm bộ thực thi trả cùng `CheckResult` (`toCheckResult(rule, { kind: 'AGENT' })`) | Không (`AGENT` đã có trong enum) |
| Nhà cung cấp ngoài (AML...) | `kind: 'EXTERNAL'` | Không |
| Chỉ số tài chính | Thêm phần tử `financials` | Không |
| Phân khúc mới (SME, doanh nghiệp lớn, cá nhân) | Khai báo `segment` ở `loan_products.json` (cả hai bản), thêm giá trị vào `SEGMENTS` nếu chưa có | MINOR nếu thêm giá trị enum |
| Dữ liệu riêng của phân khúc | Đưa vào `extensions["segment.<x>"] = { version, data }`, có JSON Schema riêng | Không |

### Rule Agent

Agent khác LLM ở **cách thu thập bằng chứng** (nhiều bước, gọi công cụ), không khác ở đầu ra. Kết luận cuối của Agent phải qua cùng
`ModelCheckOutputSchema` và cùng các rào an toàn: evidence phải hợp lệ, `PASS` cần evidence `ACCEPTED`, dưới ngưỡng tin cậy thì `REVIEW`,
mã ngoài danh sách thì `UNKNOWN_CODE`. Chuỗi suy luận và công cụ đã gọi thuộc audit nội bộ, **không** đi vào payload tích hợp.

## 6. Đảm bảo bằng test

- `tests/loan-appraisal/check-contract.test.ts`: payload thật qua `IntegrationPayloadSchema`; thêm 30 kiểm tra hỗn hợp ENGINE/LLM/AGENT
  không đổi schema; mã đóng; zod parse; JSON Schema không chứa evidence.
- `tests/loan-appraisal/v2-output.test.ts`: payload từ workflow thật hợp lệ, không có khóa tiến trình / evidence / công thức, họ tên và số
  định danh xuất hiện đúng một lần, chứng từ thiếu xuất hiện đúng một lần.

Khi đổi `integration-contract.ts` mà test này đỏ nghĩa là đang phá contract: cân nhắc MINOR hay MAJOR trước khi sửa test.

## 7. Lấy JSON Schema

```ts
import { integrationJsonSchema } from '@/lib/pipelines/workflows/loan-appraisal/integration-contract';
const schema = integrationJsonSchema(); // JSON Schema 2020-12
```

Đề xuất bước tiếp: xuất file này ra `docs/loan-appraisal/integration-contract.schema.json` bằng script khi phát hành, và đính kèm vào gói
tích hợp của đối tác.
