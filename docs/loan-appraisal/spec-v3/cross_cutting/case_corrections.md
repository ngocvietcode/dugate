# Hiệu chỉnh hồ sơ và tính lại (`case_corrections`, COR)

> Trạng thái: **ĐỀ XUẤT (2026-10-30), chưa cài đặt.** Áp dụng trên workflow `loan-appraisal` sau D-120 (LAC là đường duy nhất của
> rule LLM). Giữ nguyên nguyên tắc không lưu trạng thái của [04_data_model.md](../04_data_model.md) (D-01, D-02, D-03): DUGate không
> thêm bảng hay route; hiệu chỉnh do hệ thống gọi giữ và gửi lại. Dùng lại mô hình `FieldEdit` (04_data_model §5) cho lỗi đọc OCR;
> task T-COR-02 thay T-EDIT-01 (đang ghi "không áp dụng trên nền v2").

## 1. Mục đích

Hiện người thẩm định **không có cách nào** đưa thông tin của mình vào hồ sơ đã chạy rồi tính lại (kiểm 2026-10-30):

| Thứ có sẵn | Vì sao không dùng được |
|---|---|
| `acknowledgements` (giải trình finding giai đoạn 1) | Chỉ chuyển finding sang `ACCEPTED` kèm lý do; không sửa dữ kiện, không vào S3 / LAC. UI không có ô nhập |
| `POST /operations/{id}/resume` kèm `{ step, extracted_data }` | Chỉ khi `WAITING_USER_INPUT`, mà loan-appraisal chỉ dừng sau giai đoạn 1, **trước** S2: chưa có OCR để sửa. Ghi đè nguyên khối JSON, không biết sửa gì, ai sửa, vì sao. Hồ sơ đã xong thì bị từ chối |

Ba việc người thẩm định cần làm, ứng với ba lỗi khác nhau của hệ thống:

| Người thẩm định nói | Thực chất | Sửa ở đâu |
|---|---|---|
| "CCCD ghi 001090000001, máy đọc thành 001090000007" | OCR đọc sai một lá | Evidence, trước S3 (`OCR_FIX`) |
| "Đơn vay ghi sai số GCN; số đúng là số trên GCN" | Hai chứng từ ghi khác nhau thật; người chọn bên đúng | LAC (`FACT_RESOLUTION`) |
| "Hai tài sản này là một" / "hai người này khác nhau" | S3 gom sai | S3 (`SAME_SUBJECT` / `DIFFERENT_SUBJECT`) |

Gộp ba việc vào một "sửa giá trị" sẽ sai: sửa evidence cho ca thứ hai là **làm giả chứng từ** (đơn vay thật sự ghi sai), còn chọn giá
trị ở LAC cho ca thứ ba không gỡ được người/tài sản đã gộp nhầm ở S3, nên graph, hồ sơ 360 và prompt vẫn lệch nhau.

Lưu ý: "AA 1234" và "AA 123 4" **không** cần hiệu chỉnh — `normKey` đã bỏ khoảng trắng, dấu chấm, gạch ngang khi so khóa tài sản.

## 2. Phạm vi

| Làm | Không làm |
|---|---|
| Ba loại hiệu chỉnh có cấu trúc, tham chiếu bằng mã ổn định (COR-R05) | Không nhận văn bản tự do ("số đúng là …") và không đưa văn bản của người vào prompt |
| Tính lại = Operation mới của cùng workflow từ `case_input.json`, bỏ S1/S2 | Không thêm bảng, cột, route (D-01); không đọc Operation khác (D-02) |
| Niêm phong `documents` của kết quả để hệ thống gọi không sửa lén được OCR | Không xác minh danh tính người sửa: `corrected_by` do hệ thống gọi khai |
| Báo cáo áp được / bỏ qua từng hiệu chỉnh | Không cho nhập giá trị mà không chứng từ nào ghi (COR-R04) |
| UI `/loan-appraisal-v2`: sửa trên mâu thuẫn / dữ kiện / cặp chủ thể, giữ trong bộ nhớ trang, nút "Tính lại" | Không lưu hiệu chỉnh ở `localStorage` hay DB phía DUGate |
| | Không đổi payload tích hợp ở v1 (OQ-COR-03) |

## 3. Luồng

```
Operation A (chạy thường)          result: documents (classify + evidences) + case_seal, LAC/360/rule…
        │  hệ thống gọi / UI giữ documents + case_seal, người thẩm định thêm corrections[]
        ▼
Operation B (tính lại)             POST /api/v1/docs/workflows  process=loan-appraisal  files[]=case_input.json
   kiểm niêm phong (COR-R03) ── sai → FAILED, INPUT_INVALID: CASE_SEAL_INVALID
   bỏ S1, S2: checkpoint dựng từ documents
   applyOcrFixes(evidences, OCR_FIX)                        (COR-R07, F-R06)
   S3 runMapDossier(…, links = SAME/DIFFERENT_SUBJECT)      (COR-R08)
   buildLoanApplicationContext(…, resolutions)              (COR-R09)
   hồ sơ 360 → tài chính → rule engine + rule LLM → khuyến nghị
   result: như A + correction_report + case_seal mới (cùng documents)
```

Operation A không đổi: kết quả cũ vẫn mở được để đối chiếu. Tính lại lần nữa thì gửi lại **đủ** danh sách hiệu chỉnh (COR-R15).

## 4. Mô hình dữ liệu

```ts
export const CASE_INPUT_CONTRACT = 'loan-appraisal.case-input';
export const CASE_INPUT_VERSION = '1.0';

export interface CaseInput {
  contract: typeof CASE_INPUT_CONTRACT;
  contract_version: typeof CASE_INPUT_VERSION;
  /** Nguyên văn `result.documents` của Operation nguồn (classify + evidences). Nằm trong niêm phong. */
  documents: DossierOutputV3['documents'];
  /** Nguyên văn `result.case_seal` của Operation nguồn. */
  case_seal: CaseSeal;
  /** Ngoài niêm phong: do người thẩm định tạo. Tối đa 200. */
  corrections: Correction[];
}

export interface CaseSeal {
  alg: 'HMAC-SHA256';
  key_id: 'v1';
  source_operation_id: string;
  product_code: string;
  flow: string | null;
  workflow_version: string;
  /** hex, 64 ký tự. */
  mac: string;
}

interface CorrectionBase {
  /** Do hệ thống gọi đặt, duy nhất trong mảng: /^[A-Za-z0-9_-]{1,64}$/. */
  correction_id: string;
  /** 1..500 ký tự. Có thể chứa PII: không log, không vào prompt (COR-R12). */
  reason: string;
  /** Mã người sửa ở hệ thống gọi, 1..64 ký tự. DUGate không xác minh. */
  corrected_by: string;
  corrected_at: string; // ISO 8601
}

/** Lỗi đọc: chứng từ ghi `value`, OCR đọc thành `original_value`. = FieldEdit (04_data_model §5). */
export interface OcrFix extends CorrectionBase {
  kind: 'OCR_FIX';
  /** `{evidence_id}#{field_path}`, lá nguyên thủy (cùng dạng LacSource.record_id). */
  record_id: string;
  original_value: string | number | boolean | null;
  value: string | number | boolean | null;
}

/** Hai (hoặc hơn) chứng từ ghi khác nhau thật; người chọn bên đúng. Không sửa chứng từ nào. */
export interface FactResolution extends CorrectionBase {
  kind: 'FACT_RESOLUTION';
  /** Mọi record_id của nhóm mâu thuẫn mà người đã xem (≥ 2). */
  record_ids: string[];
  /** Phải thuộc `record_ids`. */
  chosen_record_id: string;
}

/** Hai lần xuất hiện của party / tài sản trên chứng từ là cùng một (SAME) hoặc khác nhau (DIFFERENT). */
export interface SubjectLink extends CorrectionBase {
  kind: 'SAME_SUBJECT' | 'DIFFERENT_SUBJECT';
  subject_kind: 'person' | 'asset';
  /** person: party_index trong `data.parties[]`; asset: asset_index trong `data.assets[]` (= PartyRef / Descriptor của S3). */
  a: { evidence_id: string; index: number };
  b: { evidence_id: string; index: number };
}

export type Correction = OcrFix | FactResolution | SubjectLink;

export interface CorrectionReport {
  source_operation_id: string;
  applied: Array<{ correction_id: string; kind: Correction['kind'] }>;
  skipped: Array<{ correction_id: string; kind: Correction['kind']; code: CorrectionSkipCode }>;
}

export type CorrectionSkipCode =
  // OCR_FIX: đúng các mã của 04_data_model §5
  | 'ORPHAN_EDIT' | 'FIELD_NOT_EDITABLE' | 'EDIT_ON_ERROR_EVIDENCE' | 'EDIT_BASE_CHANGED' | 'INVALID_VALUE'
  // SAME / DIFFERENT_SUBJECT
  | 'LINK_ORPHAN'            // evidence / index không có
  | 'LINK_CONTRADICTS_ID'    // DIFFERENT nhưng hai party cùng số định danh hợp lệ, hoặc hai tài sản cùng khóa chính xác
  | 'LINK_CYCLE'             // các liên kết mâu thuẫn nhau (A=B, B=C, A≠C): bỏ cả nhóm
  // FACT_RESOLUTION
  | 'RESOLUTION_ORPHAN'      // record_id không có trong LAC
  | 'RESOLUTION_STALE'       // sau S3 / OCR_FIX các record không còn cùng (chủ thể, trường) hoặc không còn mâu thuẫn
  | 'DUPLICATE_TARGET';      // hai hiệu chỉnh cùng đích; giữ bản corrected_at mới nhất, bản kia bỏ
```

LAC (spec [loan_application_context.md](loan_application_context.md) §4) thêm:

```ts
LacTrust: … | 'OVERRULED';               // giá trị người thẩm định đã bác
LacFact.adjudication: { correction_id: string; role: 'CHOSEN' | 'OVERRULED' } | null;
LacSource.origin: 'OCR' | 'HUMAN_EDIT';  // HUMAN_EDIT: lá đã qua OCR_FIX
LoanApplicationContext.resolutions: Array<{ correction_id: string; subject_id: string; field: string; chosen_fact_id: string; overruled_fact_ids: string[] }>;
```

Kết quả (`AppraisalResultV2`) thêm `case_seal`, `correction_report` (chỉ khi tính lại), và `reproducibility.corrections_sha256`.

## 5. Rule

| ID | Rule |
|---|---|
| **COR-R01** | **Không lưu trạng thái.** Hiệu chỉnh là dữ liệu của hệ thống gọi (với UI DUGate: bộ nhớ trang). DUGate chỉ nhận chúng trong `case_input.json` của lần tính lại; không bảng, không cột, không route mới (D-01); workflow không đọc Operation nguồn (D-02) — mọi thứ cần đều nằm trong file |
| **COR-R02** | **Tính lại là Operation mới** của `workflows:loan-appraisal`, `files[]` gồm đúng một file `case_input.json` (`application/json`, ≤ 20 MB). Có file này thì workflow bỏ S1, S2 (không gọi OCR / phân loại), dựng checkpoint của stage 0–1 từ `documents`, chạy S3 → stage 4 như thường (rule LLM có gọi lại). `stop_after_intake` bị bỏ qua. Lẫn file khác cùng `case_input.json` → `INPUT_INVALID: CASE_INPUT_MIXED` |
| **COR-R03** | **Niêm phong.** Mọi kết quả có `documents` thì có `case_seal`: `mac = HMAC-SHA256(K, canonical({contract, contract_version, source_operation_id, product_code, flow, workflow_version, documents}))`, `canonical` = JSON khóa sắp xếp, không khoảng trắng. `K = HKDF-SHA256(ENCRYPTION_KEY, salt = "", info = "dugate/loan-case-seal/v1", 32 byte)`. Tính lại: tính lại `mac` và so bằng `timingSafeEqual`; sai, thiếu, `key_id` lạ → `FAILED`, `INPUT_INVALID: CASE_SEAL_INVALID` (không nêu giá trị). `product_code`, `flow` của lần tính lại lấy từ niêm phong, không từ form. `corrections` nằm **ngoài** niêm phong. Lý do: không có niêm phong thì `case_input` là đường để gửi OCR tùy ý mà kết quả vẫn mang nhãn "OCR của DUGate" |
| **COR-R04** | **Mọi giá trị đúng phải có căn cứ chứng từ.** `OCR_FIX`: người khẳng định chứng từ ghi `value` (xem được trên bản scan). `FACT_RESOLUTION`: chọn một giá trị đang có trên chứng từ. Không có loại "giá trị khác mọi chứng từ": khi không chứng từ nào ghi đúng thì đó là thiếu / sai hồ sơ, xử lý bằng REVIEW và bổ sung chứng từ, không bằng hiệu chỉnh |
| **COR-R05** | **Mã ổn định.** Tham chiếu bằng `record_id` (`{evidence_id}#{field_path}`) và (`evidence_id`, `party_index` / `asset_index`). Không dùng `person-n`, `asset-n`, `fact-n`, `F<n>`: các mã này đánh lại sau khi S3 / LAC dựng lại. `documents` không đổi giữa các lần tính lại nên mã ổn định giữ nghĩa |
| **COR-R06** | **Thứ tự áp**: `OCR_FIX` (`applyOcrFixes`, hàm duy nhất — F-R06) → S3 với liên kết → sổ Claim / LAC với `FACT_RESOLUTION` → hồ sơ 360 → tài chính → rule. Mỗi bước nhận đầu ra đã áp của bước trước; không bước nào tự đọc `corrections` của bước khác |
| **COR-R07** | **`OCR_FIX`** = `FieldEdit` của 04_data_model §5, cùng bảng mã bỏ qua (`EDIT_BASE_CHANGED` so `original_value` với giá trị hiện tại sau chuẩn hóa). Áp được: đổi lá trong bản sao của evidence; **không** nâng `field_confidences` cấp 1 (sẽ nâng cả lá anh em chưa ai xem — khác T-EDIT-01). LAC nhận danh sách lá đã sửa, đặt `origin = HUMAN_EDIT` và `read_confidence = 1.0` cho **đúng lá đó**. `EvidenceRegistry` cũng đánh `ACCEPTED` cho đúng record đó. Evidence `ERROR` không sửa được |
| **COR-R08** | **Liên kết chủ thể** (S3). `SAME_SUBJECT` = must-link: hai lần xuất hiện vào cùng người / tài sản, thắng mọi luật không ghép (tên khác, FS dưới ngưỡng, khóa khác); cờ soát số định danh (`ID_NUMBER_REVIEW`) vẫn giữ nếu số khác nhau. `DIFFERENT_SUBJECT` = cannot-link: thắng ghép theo tên, FS, khóa gần đúng; **không** thắng hai party cùng số định danh hợp lệ hoặc hai tài sản cùng khóa chính xác → bỏ, `LINK_CONTRADICTS_ID` (cùng số mà khác người là việc của KYC, không phải của hiệu chỉnh). Đóng bắc cầu các SAME; một DIFFERENT nằm trong cùng thành phần SAME → bỏ mọi liên kết của thành phần đó, `LINK_CYCLE`. Party anchor (đơn vay) cũng liên kết được như mọi party |
| **COR-R09** | **`FACT_RESOLUTION`** (LAC). Áp khi sau S3: mọi `record_ids` còn trong LAC, cùng (`subject_id`, `field`), và nhóm đó đang có fact `DISPUTED` / `PROBABLE_OCR_ERROR`; ngược lại `RESOLUTION_ORPHAN` / `RESOLUTION_STALE`. Fact chứa `chosen_record_id`: `adjudication.role = CHOSEN`, `trust` tính lại **như không có mâu thuẫn** (CORROBORATED / SINGLE_SOURCE / DECLARED theo nguồn của chính nó, D-112). Các fact còn lại của nhóm: `trust = OVERRULED`, `role = OVERRULED`. Nhóm bị gỡ khỏi `conflicts`, thêm vào `resolutions`. Fact của nhóm mà người chưa xem (record không có trong `record_ids`) giữ nguyên `DISPUTED` và nhóm vẫn ở `conflicts` |
| **COR-R10** | **Rào rule LLM.** `OVERRULED` thêm vào tập không cho PASS (cùng `PROMPT_CHECK_EVIDENCE_DISPUTED`). Fact `CHOSEN` đi theo trust tính lại: chọn giá trị chỉ có trên đơn vay vẫn là `DECLARED`, vẫn bị `DECLARED_ONLY`. Hiệu chỉnh **không** tạo trạng thái "đã xác nhận" để vượt rào lời khai (OQ-COR-01) |
| **COR-R11** | **Prompt.** Thêm mục `HIỆU CHỈNH CỦA NGƯỜI THẨM ĐỊNH` sau `MÂU THUẪN`: mỗi resolution một dòng `<subject_id> · <nhãn>: chọn F<a> (<nguồn>) thay F<b> …`; mỗi liên kết một dòng `<subject_id>: gộp / tách theo người thẩm định`. Dòng fact có nguồn `HUMAN_EDIT` ghi thêm `; đã sửa đọc`. Fact `OVERRULED` không có dòng riêng. **Không** đưa `reason`, `corrected_by`, `correction_id` vào prompt. Template mặc định thêm quy tắc: "mục HIỆU CHỈNH là quyết định của người thẩm định, không đánh giá lại" |
| **COR-R12** | **PII.** `reason`, `corrected_by`, `value`, `original_value` không vào log, `content_preview`, warning, message lỗi. `content_preview` của stage 3 chỉ có số đếm theo `kind` và theo mã bỏ qua |
| **COR-R13** | **Báo cáo & tái lập.** Kết quả tính lại có `correction_report` (§4) và `reproducibility.corrections_sha256` = sha256 của `canonical(corrections)`; `case_seal` mới giữ `source_operation_id` của Operation **gốc** (Operation chạy OCR), không phải Operation tính lại gần nhất. Không bao giờ báo `applied` cho hiệu chỉnh bị bỏ qua (SECURITY-RULES §3) |
| **COR-R14** | **Kiểm đầu vào** bằng zod `.strict()` (D-05): ≤ 200 hiệu chỉnh, `correction_id` duy nhất, độ dài như §4, `chosen_record_id ∈ record_ids`, `a ≠ b`. Sai → `FAILED`, `INPUT_INVALID: INVALID_CASE_INPUT — <đường dẫn>` (tối đa 20 đường dẫn, không giá trị — D-07). Hai hiệu chỉnh cùng đích (cùng `record_id` cho `OCR_FIX`; cùng nhóm cho `FACT_RESOLUTION`; cùng cặp cho liên kết) → bản `corrected_at` mới nhất thắng, bản kia `DUPLICATE_TARGET` |
| **COR-R15** | **Không cộng dồn.** Mỗi lần tính lại dùng đúng `corrections` trong file; hiệu chỉnh của lần trước không tự mang sang (D-02). UI và hệ thống gọi giữ danh sách đầy đủ. `documents` lấy từ kết quả nào cũng được (gốc hay tính lại) vì giống nhau và cùng niêm phong |
| **COR-R16** | **UI `/loan-appraisal-v2`.** Trên mục mâu thuẫn: "Chọn giá trị đúng" → `FACT_RESOLUTION` (người phải chọn một giá trị đang có). Trên dòng dữ kiện / lá OCR: "Máy đọc sai" → `OCR_FIX` (hiện `original_value`, nhập `value`). Trên cặp người / tài sản (graph, hồ sơ 360): "Là một" / "Không phải một" → liên kết. `reason` bắt buộc. Danh sách giữ trong state của trang (không `localStorage`: chứa PII), hiện số hiệu chỉnh chưa tính; nút "Tính lại" gửi `case_input.json` bằng API key đang dùng. Sau khi xong hiện `correction_report` (mục bỏ qua kèm lý do theo mã), cho mở lại kết quả gốc. Có nút tải `case_input.json` để giữ ngoài trình duyệt. `case_input` dựng được từ response `view=compact` mà trang đang poll: `compact-view.ts` giữ nguyên `documents` và `case_seal` (không rút gọn, không đổi thứ tự khóa — mac tính trên `canonical` nên thứ tự không ảnh hưởng, nhưng mất một lá là hỏng niêm phong). Khi có hiệu chỉnh chưa tính, trang báo hạn tính lại theo `OPERATION_CONTENT_RETENTION_DAYS` (COR-R17) và gợi ý tải file |
| **COR-R17** | **Hết hạn và đổi khóa.** DUGate không phụ thuộc thời hạn giữ nội dung Operation (`OPERATION_CONTENT_RETENTION_DAYS`, mặc định 7 ngày) vì niêm phong tự kiểm được, nhưng **nơi giữ `documents` thì có**: hệ thống gọi lưu kết quả của mình thì tính lại được bất cứ lúc nào; UI DUGate đọc lại kết quả từ Operation, nên sau thời hạn đó `GET /operations/{id}` không còn `documents` và chỉ tính lại được từ file `case_input.json` đã tải về — không có file thì phải chạy lại từ chứng từ (OCR lại). Đổi `ENCRYPTION_KEY` làm hỏng mọi niêm phong cũ → phải chạy lại từ chứng từ; `key_id` để sau này hỗ trợ nhiều khóa (OQ-COR-04) |

## 6. Acceptance criteria

| # | Tiêu chí |
|---|---|
| COR-AC01 | Kết quả chạy thường có `case_seal`; gửi lại `documents` + seal không có hiệu chỉnh → rule, hồ sơ 360, `loan_application_context_summary.source_hash` giống hệt Operation nguồn (trừ id / thời gian), và không có lời gọi OCR / phân loại nào (đếm `enqueueSubStep`) |
| COR-AC02 | Đổi một ký tự bất kỳ trong `documents`, hoặc đổi `product_code` / `flow` trong niêm phong → `INPUT_INVALID: CASE_SEAL_INVALID` |
| COR-AC03 | `OCR_FIX` số CCCD lệch 1 ký tự → mâu thuẫn `PROBABLE_OCR_ERROR` biến mất, fact thành `CORROBORATED`, dòng prompt có "đã sửa đọc"; lá anh em cùng khóa cấp 1 giữ `read_confidence` cũ |
| COR-AC04 | `OCR_FIX` có `original_value` khác giá trị hiện tại → `EDIT_BASE_CHANGED`, không áp, có trong `skipped` |
| COR-AC05 | `FACT_RESOLUTION` chọn số GCN trên GCN, bác số trên đơn vay → `conflicts` không còn nhóm đó, fact chọn `SINGLE_SOURCE`/`CORROBORATED`, fact bị bác `OVERRULED`; PASS dẫn fact bị bác → `REVIEW` / `PROMPT_CHECK_EVIDENCE_DISPUTED` |
| COR-AC06 | `FACT_RESOLUTION` chọn giá trị chỉ có trên đơn vay → fact `DECLARED`; PASS dẫn nó → `PROMPT_CHECK_DECLARED_ONLY` |
| COR-AC07 | `SAME_SUBJECT` hai tài sản (GCN và chứng thư, số lệch thật) → một `asset-n`; hồ sơ 360, graph, LAC cùng một tài sản |
| COR-AC08 | `DIFFERENT_SUBJECT` cha / con trùng tên → hai người; cùng liên kết trên hai party cùng số định danh hợp lệ → `LINK_CONTRADICTS_ID`, không tách |
| COR-AC09 | A=B, B=C, A≠C → cả ba liên kết `LINK_CYCLE`, kết quả S3 như không có liên kết |
| COR-AC10 | Không có `reason`, `corrected_by`, `value` nào trong log, `content_preview`, warning, prompt (test quét theo giá trị của fixture, như `lac-pii.test.ts`) |
| COR-AC11 | Gửi lại cùng `case_input.json` hai lần → hai kết quả giống nhau từng byte ở phần tất định; đảo thứ tự `corrections` không đổi kết quả |

## 7. Task cards

### T-COR-01 — Hợp đồng case input và niêm phong
- Depends: —
- Files: `lib/loan-dossier/corrections/schema.ts`, `lib/loan-dossier/corrections/seal.ts`, `tests/loan-dossier/corrections-contract.test.ts`
- Refs: D-04, D-05, COR-R03, COR-R14
- Làm: zod `CaseInputSchema`, `CorrectionSchema` (§4, `.strict()`); `canonicalJson`; `sealDocuments(input): CaseSeal`, `verifySeal(caseInput): boolean` (HKDF từ `ENCRYPTION_KEY`, `timingSafeEqual`). Đọc docs/SECURITY-RULES.md trước (khóa, §7 đặt tên, §9 hash).
- DoD:
  - test: seal rồi verify → true; đổi 1 ký tự `documents` / `product_code` → false (COR-AC02)
  - test: `key_id` lạ, `mac` sai độ dài → false, không ném lỗi
  - test: schema từ chối field lạ, `correction_id` trùng, `chosen_record_id ∉ record_ids`, > 200 mục
  - test: `canonicalJson` không phụ thuộc thứ tự khóa
- Verify: `npx jest tests/loan-dossier/corrections-contract.test.ts`

### T-COR-02 — Áp OCR_FIX lên evidence (hàm thuần)
- Depends: T-COR-01
- Files: `lib/loan-dossier/corrections/ocr-fix.ts`, `tests/loan-dossier/corrections-ocr-fix.test.ts`
- Refs: D-03, F-R06, COR-R07
- Làm: `applyOcrFixes(evidences, fixes) → { evidences, edited_record_ids, report }` theo 04_data_model §5 (thay T-EDIT-01); không đổi đầu vào; không nâng `field_confidences`.
- DoD:
  - test: không có bản vá → bản sao sâu bằng đầu vào
  - test: mỗi mã bỏ qua của §5 một test; `data.parties[1].id_number` áp đúng phần tử
  - test: `field_confidences` giữ nguyên; `edited_record_ids` chỉ có lá đã áp (COR-AC03, COR-AC04)
- Verify: `npx jest tests/loan-dossier/corrections-ocr-fix.test.ts`

### T-COR-03 — Liên kết chủ thể trong S3
- Depends: T-COR-01
- Files: `lib/loan-dossier/s3/links.ts`, `lib/loan-dossier/s3/match-parties.ts`, `lib/loan-dossier/s3/asset-group.ts`, `lib/loan-dossier/s3/run.ts`, `tests/loan-dossier/s3-links.test.ts`
- Refs: COR-R08, COR-R05
- Làm: `resolveLinks(links, evidences) → { same, different, report }` (đóng bắc cầu, `LINK_CYCLE`, `LINK_ORPHAN`, `LINK_CONTRADICTS_ID`); `MapDossierInput.links`; `matchParties` / `groupAssets` áp must-link / cannot-link trước luật và FS. Không có liên kết → kết quả S3 giống hệt hiện tại.
- DoD:
  - test: COR-AC07, COR-AC08, COR-AC09
  - test: không truyền `links` → snapshot S3 của mọi fixture không đổi
  - test: SAME giữa party anchor và party CCCD khác số → một người, còn `ID_NUMBER_REVIEW`
- Verify: `npx jest tests/loan-dossier/s3-links.test.ts tests/loan-dossier`

### T-COR-04 — FACT_RESOLUTION trong LAC, render và rào
- Depends: T-COR-02, T-COR-03
- Files: `lib/loan-dossier/context/schema.ts`, `lib/loan-dossier/context/build.ts`, `lib/loan-dossier/context/render.ts`, `lib/pipelines/workflows/loan-appraisal/prompt-checks.ts`, `tests/loan-dossier/context-resolutions.test.ts`
- Refs: COR-R09, COR-R10, COR-R11, COR-R07
- Làm: `BuildLacInput.resolutions`, `edited_record_ids`; trust `OVERRULED`, `adjudication`, `origin`; `resolutions`; mục `HIỆU CHỈNH CỦA NGƯỜI THẨM ĐỊNH`; `OVERRULED` vào `UNSAFE_PASS_TRUST`; quy tắc mới trong `POLICY_CHECKS_PROMPT_TEMPLATE`. Bất biến lossless của LAC giữ nguyên.
- DoD:
  - test: COR-AC05, COR-AC06; nhóm có record người chưa xem → vẫn ở `conflicts`
  - test: `RESOLUTION_STALE` khi liên kết làm hai record sang hai chủ thể khác nhau
  - test: prompt không chứa `reason` / `corrected_by` / `correction_id`
  - test: không có hiệu chỉnh → LAC và text render giống hệt hiện tại
- Verify: `npx jest tests/loan-dossier/context-resolutions.test.ts tests/loan-dossier tests/loan-appraisal/prompt-checks-lac.test.ts`

### T-COR-05 — Workflow: tính lại từ case input
- Depends: T-COR-04
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `lib/pipelines/workflows/loan-appraisal/case-input.ts`, `lib/pipelines/workflows/loan-appraisal/evidence-v3.ts`, `lib/pipelines/workflows/loan-appraisal/compact-view.ts`, `lib/pipelines/workflows/loan-appraisal/types.ts`, `lib/pipelines/workflows/loan-appraisal/reproducibility.ts`, `lib/endpoints/registry.ts`, `tests/loan-appraisal/case-recompute.test.ts`
- Refs: D-01, D-02, D-07, COR-R02, COR-R03, COR-R06, COR-R07, COR-R13, COR-R17
- Làm: nhận diện `case_input.json` (COR-R02), kiểm schema + niêm phong, dựng checkpoint stage 0–1, chuyền OCR_FIX / liên kết / resolution theo COR-R06; `buildEvidenceRegistryV3` nhận `edited_record_ids` (ACCEPTED đúng record đó); mọi kết quả có `documents` thêm `case_seal`; `correction_report`; `corrections_sha256`. Mô tả trong registry. Không route, không bảng. Bước đầu: kiểm `result.documents.classify` có đủ để dựng `ClassifyCheckpoint` mà `buildDeferredDossierOutput` cần không; thiếu thì bổ sung vào `documents` (nằm trong niêm phong) trước khi làm phần còn lại.
- DoD:
  - test: COR-AC01, COR-AC02, COR-AC11
  - test: lẫn file khác → `CASE_INPUT_MIXED`; schema sai → `INVALID_CASE_INPUT` không có giá trị trong message
  - test: `case_seal.source_operation_id` của lần tính lại thứ hai = Operation gốc
  - test: `case_input` dựng từ `compactAppraisalResult(result)` qua kiểm niêm phong (COR-R16)
- Verify: `npx jest tests/loan-appraisal/case-recompute.test.ts tests/loan-appraisal`

### T-COR-06 — Giao diện hiệu chỉnh và tính lại
- Depends: T-COR-05
- Files: `app/loan-appraisal-v2/lib/corrections.ts`, `app/loan-appraisal-v2/lib/api.ts`, `components/loan-appraisal-v2/appraisal/CorrectionsPanel.tsx`, `tests/loan-appraisal-v2/corrections.test.ts`
- Refs: COR-R16, COR-R05
- Làm: reducer thuần cho danh sách hiệu chỉnh (thêm, sửa, xóa, trùng đích); dựng `case_input.json` từ kết quả hiện tại; `submitRecompute`; nút trên mâu thuẫn / dữ kiện / cặp chủ thể; hiển thị `correction_report`; tải file.
- DoD:
  - test: reducer — trùng đích thay bản cũ; xóa; dựng case input dùng mã ổn định (không `person-n` / `F<n>`)
  - test: không có gì ghi vào `localStorage`
  - test: mã bỏ qua nào cũng có nhãn tiếng Việt
  - test: có hiệu chỉnh chưa tính → hiện hạn tính lại (ngày tạo Operation + `OPERATION_CONTENT_RETENTION_DAYS`) và nút tải file (COR-R17)
- Verify: `npx jest tests/loan-appraisal-v2/corrections.test.ts`

### T-COR-07 — PII, tài liệu
- Depends: T-COR-05
- Files: `tests/loan-appraisal/corrections-pii.test.ts`, `lib/pipelines/workflows/loan-appraisal/README.md`, `docs/DU_INTEGRATION_GUIDE.md`
- Refs: COR-R12, COR-R01
- Làm: test quét PII theo COR-AC10; README (mục tính lại); hướng dẫn tích hợp cho hệ thống gọi: giữ `documents` + `case_seal`, giữ danh sách hiệu chỉnh, gửi lại đủ.
- DoD:
  - test: COR-AC10
  - tài liệu có ví dụ `case_input.json` với dữ liệu giả
- Verify: `npx jest tests/loan-appraisal/corrections-pii.test.ts`

## 8. Điểm cần quyết

| ID | Câu hỏi | Mặc định đề xuất | Ai quyết |
|---|---|---|---|
| **OQ-COR-01** | Người thẩm định xác nhận một giá trị chỉ có trên đơn vay ("đã gọi khách xác nhận") có được vượt rào `DECLARED_ONLY` không | Không ở v1: hiệu chỉnh chọn giá trị, không tạo bằng chứng. Muốn PASS thì bổ sung chứng từ hoặc dùng `allow_declared_pass` của rule | Risk |
| **OQ-COR-02** | Có cần maker–checker (một người sửa, người khác duyệt) trước khi tính lại | Do hệ thống gọi làm (nó là nơi lưu); DUGate chỉ chở `corrected_by`. UI DUGate v1 không có bước duyệt | Risk + PO |
| **OQ-COR-03** | Payload tích hợp có mang `correction_report` / đánh dấu kết quả "đã hiệu chỉnh" không | Không ở v1; hệ thống gọi đã có danh sách hiệu chỉnh của chính nó | PO + hệ thống gọi |
| **OQ-COR-04** | Đổi `ENCRYPTION_KEY` có cần giữ khóa niêm phong cũ để `case_input` cũ vẫn dùng được | Không ở v1 (chạy lại từ chứng từ); `key_id` để mở rộng | Dev lead |
| **OQ-COR-05** | Cho phép `OCR_FIX` trên evidence `LIGHT` (bóc tách nhẹ) không | Có, cùng luật; chỉ lá có trong `data` | BA |
