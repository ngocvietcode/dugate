# Loan Application Context (`loan_application_context`, LAC)

> Trạng thái: **đã cài đặt T-LAC-01…06 (IMPLEMENT D-103, 2026-10-27); `lac_mode` mặc định `off`.** Bật làm mặc định chờ
> T-LAC-07 (đo trên bộ UAT). Các điểm §9 dùng **mặc định đề xuất**. Áp dụng trên workflow v2 ([v2_integration.md](v2_integration.md)),
> giai đoạn 2. Không thay [master_dossier.md](master_dossier.md); quan hệ giữa hai bản ở §3.
>
> **Lệch so với bản đề xuất (D-103):** (1) fact có thêm `hidden` (thay cho "không render" của LAC-R04), phủ cả mã vai trò / loại
> party theo chứng từ, `ownership.*` (đã thành quan hệ) và thành phần địa chỉ khi đã có `full_text`; (2) `meta.superseded_evidence_ids`;
> (3) gộp fact TRÙNG giá trị cho mọi chủ thể (không chỉ khoản vay / kinh doanh) để không lặp dòng; (4) quan hệ OWNS / SPOUSE_OF /
> LEGAL_REP_OF mang `verification.status = NOT_REQUIRED` (chỉ RELATIVE_OF có xác minh); (5) ghi đè trên Profile vẫn khoan dung với
> `input` lạ khi đọc, nhưng `lac.document.<doc>` lạ bị từ chối khi ghi (fail-closed như V2-R07).

## 1. Mục đích

Rule LLM (stage 3, `prompt-checks.ts`) hiện nhận hồ sơ qua **hai khối tách rời**:

| Khối | Nguồn | Gọi chủ thể bằng | Dẫn nguồn được? |
|---|---|---|---|
| `{{master_data}}` | `renderDossierGraph` (S3) | `person-n`, `asset-n`, tên loại chứng từ | **Không.** Template ghi rõ "chỉ để định hướng, KHÔNG dùng làm evidence"; render không đưa `evidence_id` |
| `{{evidence}}` | `selectPromptEvidence` (OCR S2 thô) | `D<n>:<field path>` | Có, resolve về `EvidenceRecord` |

Hệ quả, quan sát được trên code hiện tại:

1. **Model tự gom lại thực thể.** Không có ánh xạ `D3:parties[1]` ↔ `person-2`. Model phải tự kết luận hai party là một người, đúng việc S3 đã làm tất định, và có thể kết luận khác S3.
2. **Kết luận dựa trên dữ kiện đã gom không dẫn nguồn được.** Ví dụ "chủ hiện tại của asset-1 là person-2" chỉ có ở khối graph; muốn dẫn nguồn, model phải tìm lại lá OCR tương ứng, hoặc dẫn sai và bị rào an toàn loại.
3. **Trạng thái tin cậy không tới tay model.** Sổ Claim (`graph/claims.ts`) đã tính được `CORROBORATED` / `DISPUTED` / `PROBABLE_OCR_ERROR` / `SPELLING_VARIANT` / `DECLARED`, nhưng chưa vào prompt (commit `33f51a3`). Model không phân biệt được giá trị chỉ khai trên đơn vay với giá trị đã có hai chứng từ độc lập xác nhận.
4. **Thiếu chủ thể khoản vay.** Số tiền, kỳ hạn, lãi suất, mục đích nằm trong JSON của `loan_application` như mọi field khác. Sổ Claim gắn chúng vào `loan:<evidence_id>`, nên hai bản đơn vay là hai "khoản vay".
5. **Mất dữ liệu lặng lẽ.** `buildDossierGraph` ném lỗi khi gặp bất kỳ id treo nào, và workflow đặt `dossierGraph = null`. Khi đó khối người & tài sản chỉ còn `compactMasterData({})`, mà model không được báo vì sao.

`loan_application_context` là **một view duy nhất, tất định, dẫn nguồn được** của hồ sơ vay, dựng bằng code từ S2 + S3 + sổ Claim. Nó thay hai khối trên thành một khối: mọi dữ kiện mang mã trích dẫn ngắn và trạng thái tin cậy, còn chủ thể dùng đúng mã của S3.

## 2. Phạm vi

| Làm | Không làm |
|---|---|
| Hàm thuần `buildLoanApplicationContext(evidences, s3, ledger)`, chạy trong stage 3 trước lời gọi Rule LLM | Không gọi model, không thêm stage, không lưu checkpoint (dựng lại mỗi lần, như `buildEvidenceRegistryV3`) |
| Gom chủ thể: khoản vay, hộ kinh doanh, người, tài sản, chứng từ | **Không** chọn giá trị đúng khi có tranh chấp: giữ mọi giá trị, gắn `DISPUTED` |
| Mỗi dữ kiện = một Claim, có trạng thái tin cậy và mã `F<n>` | Không sửa `data` gốc của EvidenceEnvelope, không thay S3 |
| Liệt kê sẵn mâu thuẫn và khoảng trống (`conflicts`, `gaps`) | Không so sánh ngữ nghĩa (mục đích vay ↔ quy mô KD…): đó là việc của rule |
| Render theo `input` của rule, trong ngân sách ký tự | Không đổi rule engine deterministic (stage 3) và đầu vào tài chính (stage 2) ở v1 |
| Resolve `F<n>` về `record_id` rồi áp nguyên rào an toàn hiện có, thêm rào theo trạng thái | Không đưa LAC vào payload tích hợp ở v1 (§9 OQ-LAC-04) |

## 3. Vị trí trong luồng và quan hệ với các bản có sẵn

```
stage 1  S2 extract_evidence ─── evidences[] (EvidenceEnvelope)
         S3 runMapStage ──────── role_registry, customer_360, asset_registry, superseded_evidences   (đã có, thuần)
         buildClaimLedger ────── claims[] lossless + trạng thái                                       (đã có, thuần)
stage 2  calculate_financials (không đổi)
stage 3  buildLoanApplicationContext ── LAC                                                          (MỚI, thuần)
         renderLoanApplicationContext(LAC, scope) ── text + refIndex F<n> → record_id[]                (MỚI, thuần)
         Rule LLM (ext-fact-verifier) ── {{context}} ── kết quả dẫn "F<n>"
         parsePromptCheckResults ── resolve F<n> → record_id → rào an toàn (LAC-R13)
```

| Bản | Tổ chức theo | Trạng thái | Quan hệ với LAC |
|---|---|---|---|
| `DossierGraph` (S3 → graph) | Người / tài sản / chứng từ | Đang chạy, dùng cho UI và `{{master_data}}` | LAC đọc **cạnh quan hệ** (OWNS, SPOUSE_OF, RELATIVE_OF, LEGAL_REP_OF, SUPERSEDED_BY) từ S3. Graph không còn vào prompt khi `lac_mode = on` |
| `ClaimLedger` | Chủ thể × trường × giá trị | Đang dựng, chỉ lưu phần đáng chú ý | **Nguồn dữ kiện của LAC.** LAC sửa một điểm của sổ: gộp chủ thể khoản vay / hộ kinh doanh (LAC-R03) |
| `master_dossier` | Mục checklist | **Đang tắt** cùng S4/S5 | Không phụ thuộc. Khi S4/S5 bật lại, giá trị `OCR_NORMALIZED` / `CORRECTED` của master có thể phủ lên trạng thái dữ kiện (§9 OQ-LAC-05) |

## 4. Mô hình dữ liệu

```ts
export const LAC_VERSION = '1.0';

export type LacSubjectKind = 'loan' | 'business' | 'person' | 'asset' | 'document';

export interface LoanApplicationContext {
  lac_version: typeof LAC_VERSION;
  product_code: string;
  flow: string | null;
  subjects: LacSubject[];          // thứ tự LAC-R12
  facts: LacFact[];                // 1 dữ kiện / 1 Claim (LAC-R04)
  relations: LacRelation[];        // từ S3 (LAC-R08)
  conflicts: LacConflict[];        // dựng sẵn từ facts DISPUTED / PROBABLE_OCR_ERROR (LAC-R09)
  gaps: LacGap[];                  // vì sao thiếu (LAC-R10)
  meta: {
    leaf_count: number;            // = ClaimLedger.leaf_count (bất biến lossless)
    fact_count: number;
    unresolved_count: number;
    s3_status: string | null;      // stage_status của S3, null khi S3 không chạy được
    source_hash: string;           // sha256 của (evidence_id, field_path, raw) đã sắp xếp — để tái lập
  };
}

export interface LacSubject {
  subject_id: string;              // "loan", "business-1", "person-1" (= person_id S3), "asset-1" (= asset_id S3), "doc-<n>"
  kind: LacSubjectKind;
  label: string;                   // "Khoản vay", "Hộ kinh doanh", tên người, "Nhà đất GCN …", "Báo cáo CIC"
  roles: string[];                 // person: borrower | co_borrower | collateral_owner | other:<detail>; asset: collateral | …
  /** Chứng từ có nhắc tới chủ thể (doc_type_key × số bản), để hiển thị; không phải mã trích dẫn. */
  mentioned_in: Array<{ doc_type_key: string; count: number }>;
  flags: LacSubjectFlag[];         // ROLE_CONFLICT, ID_NUMBER_REVIEW, LOW_MATCH_CONFIDENCE, NAME_SPELLING_DIFFERENCE
}

export type LacTrust =
  | 'CORROBORATED'        // ≥ 2 chứng từ khác nhau cùng giá trị
  | 'SINGLE_SOURCE'       // 1 chứng từ không phải đơn vay
  | 'DECLARED'            // chỉ đơn vay (lời khai)
  | 'SPELLING_VARIANT'    // cùng nghĩa, khác dấu
  | 'PROBABLE_OCR_ERROR'  // lệch 1 ký tự so với đa số
  | 'DISPUTED'            // khác giá trị thực chất
  | 'SUPERSEDED';         // chỉ còn nguồn là bản đã bị thay thế (S3-R27)

export interface LacFact {
  fact_id: string;                 // "fact-<n>" ổn định theo LAC-R12 (khác mã render F<n>)
  subject_id: string;
  field: string;                   // genericField: "identity.id_number", "loan_info.requested_amount"
  label: string;                   // nhãn tiếng Việt từ doc_schemas (title), fallback humanize
  value: string | number | boolean;  // nguyên văn nguồn đầu tiên (Claim.value)
  value_kind: 'text' | 'name' | 'id' | 'date' | 'money' | 'number' | 'boolean' | 'key';
  trust: LacTrust;
  review: 'ACCEPTED' | 'REVIEW';   // LAC-R06
  sources: Array<{ record_id: string; doc_type_key: string; page: number | null; read_confidence: number | null }>;
  contradicts: string[];           // fact_id
}

export interface LacRelation {
  relation_id: string;             // "rel-<n>"
  type: 'OWNS' | 'OWNED_FORMERLY' | 'SPOUSE_OF' | 'RELATIVE_OF' | 'LEGAL_REP_OF';
  from: string; to: string;        // subject_id
  verification: { status: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED' | 'NOT_REQUIRED'; detail: string | null };
  /** Dữ kiện làm căn cứ cho quan hệ (VD party chủ sở hữu trên GCN), để model dẫn được. */
  support_fact_ids: string[];
}

export interface LacConflict {
  conflict_id: string;             // "conf-<n>"
  subject_id: string;
  field: string;
  kind: 'DISPUTED' | 'PROBABLE_OCR_ERROR';
  fact_ids: string[];              // mọi giá trị đang tranh chấp, đa số trước
}

export interface LacGap {
  code: LacGapCode;
  subject_id: string | null;
  count: number;                   // số mục bị ảnh hưởng; KHÔNG chứa giá trị (PII)
}

export type LacGapCode =
  | 'NO_LOAN_APPLICATION'          // không có anchor: không có người nào được gom
  | 'S3_UNAVAILABLE'               // S3 lỗi: chủ thể chỉ còn loan / business / document
  | 'PARTY_NOT_MAPPED'             // party trên chứng từ chưa gắn được người (unmapped_evidences)
  | 'ASSET_NOT_MAPPED'
  | 'EVIDENCE_READ_ERROR'          // evidence S2 status ≠ SUCCESS
  | 'SUPERSEDED_EVIDENCE'          // bản bị thay thế, dữ kiện của nó không render
  | 'LOAN_APPLICATION_DUPLICATE';  // > 1 đơn vay khác nhau (LAC-R03)
```

## 5. Rule

| ID | Rule |
|---|---|
| **LAC-R01** | `buildLoanApplicationContext(evidences, s3, ledger)` và `renderLoanApplicationContext(lac, scope)` là hàm thuần, tất định: cùng đầu vào → cùng output, kể cả thứ tự và mã. Không gọi model, không đọc DB. **Không log giá trị** (PII, S3-R26); log/warning chỉ nêu mã gap, id chủ thể, số đếm |
| **LAC-R02** | **Chủ thể người / tài sản** lấy nguyên `person_id` / `asset_id` của S3 làm `subject_id`, nên mọi bản chiếu (UI graph, Customer 360, LAC) gọi cùng một người bằng cùng một mã. `roles` của người = `role_registry[].roles`; của tài sản = `usage_contexts`. `flags` lấy từ S3: `role_conflict`, `id_number_check.requires_review`, `mapped_evidences[].match_confidence < 0.80`, cảnh báo `NAME_SPELLING_DIFFERENCE` |
| **LAC-R03** | **Chủ thể khoản vay và hộ kinh doanh.** Mọi Claim `loan:<evidence_id>` gộp về **một** chủ thể `loan`; mọi Claim `business:<evidence_id>` gộp về `business-1`. Sau khi gộp, các Claim cùng (`field`, `value_norm`) nhập làm một (nguồn cộng dồn), nên hai bản chụp của cùng một đơn vay cho `CORROBORATED` giữa hai bản. Hai bản đơn vay khác giá trị **định danh khoản vay** (`requested_amount`, `bank_proposed_amount`, `loan_term_months`, `interest_rate`) → `DISPUTED` và gap `LOAN_APPLICATION_DUPLICATE`. Trường định danh khoản vay được thêm vào tập tạo mâu thuẫn (mở rộng `isIdentityField` riêng cho chủ thể `loan`, không đổi hành vi của người / tài sản). Hộ kinh doanh v1 chỉ một chủ thể; tách nhiều HKD → §9 OQ-LAC-02 |
| **LAC-R04** | **Dữ kiện = Claim**, quan hệ 1–1 sau LAC-R03: không lược, không nhân đôi. Bất biến: tổng `sources` của mọi fact = `meta.leaf_count`. Lá liên kết nội bộ (`party_index`, `asset_index`, `*_indexes[]`) vẫn vào `facts` (lossless) nhưng **không render** |
| **LAC-R05** | **`trust`** ánh xạ từ `Claim.status`; thêm `SUPERSEDED` khi mọi nguồn thuộc `superseded_evidences`. Một fact có cả nguồn bị thay thế lẫn nguồn còn hiệu lực: bỏ nguồn bị thay thế khỏi `sources` khi render, `trust` tính lại trên nguồn còn lại |
| **LAC-R06** | **`review`** = `ACCEPTED` khi **mọi** nguồn có `read_confidence ≥ 0.80` (cùng ngưỡng và cùng độ phân giải cấp 1 với V2-R04), ngược lại `REVIEW`. Nhờ đó rào `PASS chỉ trên evidence ACCEPTED` hiện có cho kết quả giống hệt khi đi qua LAC |
| **LAC-R07** | **Nhãn trường.** `doc_schemas` không có nhãn từng trường (chỉ `title` cấp chứng từ). Nhãn dùng bảng `FIELD_LABELS` + `labelOf` hiện nằm ở `app/loan-appraisal-v2/lib/dossier-view.ts` (lớp UI, `claims-view.ts` đã dùng lại). Bảng này **chuyển xuống** `lib/loan-dossier/catalog/field-labels.ts` để worker dùng được; `dossier-view.ts` re-export, UI không đổi. Thiếu nhãn → humanize khóa lá. Nhãn không bao giờ chứa giá trị |
| **LAC-R08** | **Quan hệ** dựng từ S3: `OWNS` (người có trong `current_owner_person_ids`), `OWNED_FORMERLY` (chỉ trong `owner_person_ids`), `SPOUSE_OF` (gộp hai chiều thành một quan hệ), `RELATIVE_OF` (`relationship_verifications`: `verified_count ≥ required_count` → `VERIFIED`, `0 < verified_count` → `PARTIAL`, 0 → `UNVERIFIED`, `required_count = null` → `NOT_REQUIRED`), `LEGAL_REP_OF`. `support_fact_ids` = fact của chủ thể `to`/`from` có nguồn trong `mapped_evidences` / `sources` dẫn tới quan hệ (party chủ sở hữu trên GCN, party vợ/chồng trên giấy kết hôn, `verified_documents` của giấy khai sinh). Quan hệ không tìm được căn cứ vẫn render, ghi "chưa có căn cứ dẫn được" |
| **LAC-R09** | **Mâu thuẫn dựng sẵn**: mỗi nhóm (`subject_id`, `field`) có fact `DISPUTED` hoặc `PROBABLE_OCR_ERROR` → một `LacConflict`, `fact_ids` theo số chứng từ ủng hộ giảm dần. `SPELLING_VARIANT` không phải mâu thuẫn, nên không có trong `conflicts` |
| **LAC-R10** | **Khoảng trống không bao giờ lặng lẽ.** Mỗi điều kiện ở `LacGapCode` có thì ghi gap kèm `count`. Đặc biệt: S3 lỗi hoặc không có đơn vay → LAC **vẫn dựng** với `loan`, `business-1` và `doc-<n>` (Claim đã có chủ thể `document` khi không có chỉ số người / tài sản), kèm gap tương ứng. Không có trường hợp LAC rỗng mà không có gap giải thích |
| **LAC-R11** | **Phạm vi theo rule.** Khóa `input` mới: `lac.loan`, `lac.business`, `lac.person` (mọi người), `lac.person.<role>` (VD `lac.person.collateral_owner`), `lac.asset`, `lac.asset.collateral`, `lac.relations`, `lac.document.<doc_type_key>`. `conflicts`, `gaps` và **dòng định danh** của mọi chủ thể luôn được render (để model trỏ được mã chủ thể). Tương thích khóa cũ trên Profile: `evidence.<doc_type_key>` → fact có nguồn thuộc loại đó (mọi chủ thể); `master_data.identity` → `lac.person`; `.collateral` → `lac.asset` + quan hệ OWNS; `.relationship` / `.legal` → `lac.relations`; `.income` → `lac.business` + `income_sources` của người. Rule không khai `input` nào → toàn bộ LAC (vẫn trong ngân sách, LAC-R14) |
| **LAC-R12** | **Thứ tự và mã ổn định.** Chủ thể: `loan`, `business-*`, người theo thứ tự S3, tài sản theo thứ tự S3, `doc-<n>` theo thứ tự evidence S2. Fact: theo chủ thể, rồi theo thứ tự lá đầu tiên trong `data` của nguồn đầu tiên. `fact_id` (`fact-<n>`) đánh liên tục trên toàn LAC; mã render `F<n>` đánh liên tục **trên phần đã render** của từng prompt. `refIndex: Map<"F<n>", record_id[]>` dựng lại được từ cùng (LAC, scope), nên bước parse (kể cả khi resume) có đúng bảng mã như lúc dựng prompt |
| **LAC-R13** | **Dẫn nguồn và rào an toàn.** Model chỉ dẫn `F<n>` (một fact) hoặc `F<n>.<k>` (nguồn thứ k của fact, 1-based) khi muốn chỉ một chứng từ cụ thể. Parse: (1) mã không có trong `refIndex` → bỏ (giữ `PROMPT_CHECK_EVIDENCE_MISSING` khi không còn mã nào); (2) resolve về `record_id` rồi chạy **nguyên** chuỗi rào hiện có (tồn tại trong `EvidenceRegistry`, `ACCEPTED`, ngưỡng confidence); (3) **rào mới theo trạng thái**: `PASS` mà có fact dẫn chiếu ở `DISPUTED`, `PROBABLE_OCR_ERROR` hoặc `SUPERSEDED` → hạ `REVIEW`, `reason_code = PROMPT_CHECK_EVIDENCE_DISPUTED`; `PASS` mà **mọi** fact dẫn chiếu là `DECLARED` → hạ `REVIEW`, `reason_code = PROMPT_CHECK_DECLARED_ONLY`. Ngoại lệ: rule khai `allow_declared_pass: true` (rule chỉ đọc lời khai, VD kiểm tra số tiền đề nghị ≤ hạn mức) (§9 OQ-LAC-01). `RuleResult.evidence_ids` vẫn là `record_id`, nên UI và payload không đổi |
| **LAC-R14** | **Ngân sách** dùng chung `EVIDENCE_CHAR_BUDGET` (18 000 ký tự). Thứ tự ưu tiên khi vượt: (1) chú thích định dạng + gap; (2) mâu thuẫn; (3) dòng định danh chủ thể; (4) quan hệ; (5) fact trong phạm vi theo `trust` (`DISPUTED`/`PROBABLE_OCR_ERROR` → `CORROBORATED` → `SINGLE_SOURCE` → `DECLARED` → `SPELLING_VARIANT`), xoay vòng giữa các chủ thể như `selectPromptEvidence`; (6) fact `doc-<n>`. Phần bị cắt ghi một dòng `(… còn N dữ kiện của <subject_id> không hiển thị)`. Giá trị chuỗi cắt ở 160 ký tự (`MAX_VALUE_LENGTH`) |
| **LAC-R15** | **Định dạng render** (§6): một khối `untrusted_loan_context` gồm các phần `KHOẢN VAY`, `HỘ KINH DOANH`, `NGƯỜI`, `TÀI SẢN`, `QUAN HỆ`, `MÂU THUẪN`, `KHOẢNG TRỐNG`, `CHỨNG TỪ KHÁC`. Mỗi fact một dòng `F<n> <nhãn> = <giá trị> [<trust>; <nguồn>]`; `REVIEW` ghi thêm `; cần soát`. Nguồn ghi bằng `doc_type_key` (× số bản), **không** ghi tên file hay `evidence_id` |
| **LAC-R16** | **Template.** Placeholder mới `{{context}}` thay cho cặp `{{master_data}}` + `{{evidence}}`. Template mặc định (`POLICY_CHECKS_PROMPT_TEMPLATE`) đổi quy tắc 2 và 5 theo §6.2. Template ghi đè trên Profile **không có** `{{context}}` → chạy đường cũ (`{{master_data}}` + `{{evidence}}`, mã `D<n>`) và ghi `config_snapshot.warnings: LAC_TEMPLATE_LEGACY`. `ensurePlaceholders` không tự chèn `{{context}}` vào template cũ, vì template cũ hướng dẫn model dẫn `D<n>` |
| **LAC-R17** | **Chế độ** qua tham số `lac_mode`: `off` (mặc định cho tới khi duyệt T-LAC-07), `shadow`, `on`. `shadow`: dựng và render LAC, **không** gửi model; ghi thống kê vào `content_preview.lac` của stage 3 (`chars`, `facts_rendered`, `facts_total`, `conflicts`, `gaps`, `truncated`, số chủ thể theo loại). `on`: prompt dùng `{{context}}`. Lỗi khi dựng LAC ở `on` → rơi về đường cũ trong cùng lần chạy, ghi `config_snapshot.warnings: LAC_UNAVAILABLE:<tên lỗi>`, stage không đổ |
| **LAC-R18** | **Lưu trữ.** Kết quả (`AppraisalResultV2`) thêm `loan_application_context_summary = { lac_version, source_hash, mode, fact_count, rendered_fact_count, conflicts, gaps }` để audit và tái lập. LAC đầy đủ **không lưu**: dựng lại được từ `documents.evidences` + S3 (cùng lý do `claims-store.ts` chỉ lưu phần đáng chú ý). Payload tích hợp không đổi ở v1 |
| **LAC-R19** | **An toàn dữ liệu.** LAC chứa PII (tên, số định danh, địa chỉ, số GCN). Chỉ đi vào prompt (trong `untrusted_*` + `UNTRUSTED_DATA_GUARD`, như hiện nay) và bộ nhớ của worker. Không log, không đưa vào `content_preview` (chỉ số đếm), không đưa vào message lỗi |

## 6. Định dạng prompt

### 6.1 Khối `{{context}}` (ví dụ, dữ liệu giả)

```text
<untrusted_loan_context>
Ký hiệu: F<n> là mã dữ kiện, dẫn nguồn bằng mã này (VD "F3"; "F3.2" = chứng từ thứ 2 của F3).
Trạng thái: CORROBORATED = ≥2 chứng từ khớp · SINGLE_SOURCE = 1 chứng từ · DECLARED = chỉ khai trên đơn vay ·
DISPUTED = các chứng từ ghi khác nhau · PROBABLE_OCR_ERROR = nghi đọc sai 1 ký tự · "cần soát" = độ tin cậy đọc thấp.

KHOẢNG TRỐNG
- PARTY_NOT_MAPPED ×1 (1 người trên chứng từ chưa gắn được vào hồ sơ)

MÂU THUẪN
- asset-1 · Số vào sổ GCN: F21 "CN 6475" (2 chứng từ) ≠ F22 "CH.6475" (1 chứng từ) — PROBABLE_OCR_ERROR

KHOẢN VAY [loan]
F1 Số tiền đề nghị vay = 2500000000 [DECLARED; loan_application]
F2 Số tiền ngân hàng đề xuất = 2000000000 [DECLARED; loan_application]
F3 Thời hạn vay (tháng) = 36 [DECLARED; loan_application]
F4 Mục đích vay = Bổ sung vốn lưu động kinh doanh tạp hóa [DECLARED; loan_application]

HỘ KINH DOANH [business-1]
F6 Ngành nghề = Bán lẻ tạp hóa [DECLARED; loan_application]
F7 Doanh thu năm = 4800000000 [SINGLE_SOURCE; income_statement]

NGƯỜI
person-1 · borrower · NGUYEN VAN A
F10 Họ tên = NGUYỄN VĂN A [CORROBORATED; loan_application, id_card×2, marriage_certificate]
F11 Số định danh = 001090000000 [CORROBORATED; loan_application, id_card×2]
F12 Ngày sinh = 1990-01-01 [CORROBORATED; loan_application, id_card]
F13 Tình trạng hôn nhân = married [SINGLE_SOURCE; marriage_certificate]
person-2 · co_borrower/collateral_owner · TRAN THI B
F15 Họ tên = TRẦN THỊ B [CORROBORATED; loan_application, id_card, land_use_certificate]
F16 Số định danh = 001190000000 [SINGLE_SOURCE; id_card; cần soát]

TÀI SẢN
asset-1 · land · collateral
F20 Số GCN = AB 000000 [CORROBORATED; land_use_certificate×2, real_estate_valuation_report]
F21 Số vào sổ = CN 6475 [PROBABLE_OCR_ERROR; land_use_certificate×2]
F22 Số vào sổ = CH.6475 [PROBABLE_OCR_ERROR; real_estate_valuation_report]
F23 Giá trị định giá = 3500000000 [SINGLE_SOURCE; real_estate_valuation_report]

QUAN HỆ
- person-1 ⇄ person-2: vợ/chồng — căn cứ F13
- person-2 → asset-1: chủ sở hữu hiện tại — căn cứ F15.3, F20
</untrusted_loan_context>
```

### 6.2 Thay đổi quy tắc trong template mặc định

| # | Hiện tại | Khi `lac_mode = on` |
|---|---|---|
| 2 | `evidence_ids` là `"D<n>:<đường dẫn field>"` tới DỮ LIỆU CHỨNG TỪ | `evidence_ids` là mã `F<n>` (hoặc `F<n>.<k>`) có trong HỒ SƠ VAY. Không tự tạo mã |
| 5 | PASS chỉ khi field không nằm trong dòng `REVIEW:` | PASS chỉ khi mọi dữ kiện dẫn chiếu không "cần soát" và không DISPUTED / PROBABLE_OCR_ERROR. Dữ kiện chỉ DECLARED là lời khai: muốn PASS phải có dữ kiện khác xác nhận |
| mới | — | Người và tài sản đã được hệ thống gom: `person-n` / `asset-n` là cùng một chủ thể trên mọi chứng từ. Không tự gom lại; nếu thấy gom sai, trả REVIEW và nêu lý do |
| mới | — | Mâu thuẫn và khoảng trống đã được liệt kê. Kiểm tra cần dữ liệu nằm ở khoảng trống thì trả `INSUFFICIENT_DATA` |

Quy tắc 2, 5 được kiểm lại bằng code ở LAC-R13. Prompt chỉ nói trước để model ít sai, không phải hàng rào.

## 7. Acceptance criteria

| # | Tiêu chí |
|---|---|
| AC-1 | Cùng fixture → `buildLoanApplicationContext` và `renderLoanApplicationContext` cho output giống hệt từng byte qua 2 lần chạy và sau khi xáo thứ tự khóa JSON đầu vào |
| AC-2 | Bất biến lossless: Σ `facts[].sources.length` = `meta.leaf_count` = `ClaimLedger.leaf_count` trên mọi fixture `tests/loan-dossier/fixtures` |
| AC-3 | Hai bản chụp cùng một đơn vay → một chủ thể `loan`, các dữ kiện khoản vay `CORROBORATED`. Hai đơn vay khác số tiền → `DISPUTED` + gap `LOAN_APPLICATION_DUPLICATE` |
| AC-4 | S3 trả `null` → LAC vẫn có `loan`, `business-1`, `doc-<n>` và gap `S3_UNAVAILABLE`; render không rỗng |
| AC-5 | Mọi `F<n>` / `F<n>.<k>` trong text render có trong `refIndex`; mọi `record_id` trong `refIndex` tồn tại trong `EvidenceRegistry` |
| AC-6 | Model dẫn `F<n>` của fact `DISPUTED` kèm `PASS` → kết quả `REVIEW`/`PROMPT_CHECK_EVIDENCE_DISPUTED`. Chỉ dẫn fact `DECLARED` kèm `PASS` → `REVIEW`/`PROMPT_CHECK_DECLARED_ONLY`, trừ rule `allow_declared_pass` |
| AC-7 | Mã lạ (`F999`, `D1:…` khi `on`) bị bỏ; không còn mã hợp lệ → `PROMPT_CHECK_EVIDENCE_MISSING` như hiện nay |
| AC-8 | Rule khai `master_data.collateral` (khóa cũ) nhận đúng phần `TÀI SẢN` + quan hệ OWNS; rule khai `evidence.id_card` nhận fact có nguồn `id_card` |
| AC-9 | Fixture vượt ngân sách: text ≤ 18 000 ký tự, phần `MÂU THUẪN` và `KHOẢNG TRỐNG` còn đủ, có dòng `(… còn N dữ kiện …)` |
| AC-10 | Template ghi đè không có `{{context}}` → prompt giống hệt đường cũ, có warning `LAC_TEMPLATE_LEGACY` |
| AC-11 | Không có giá trị fact nào trong log, `content_preview`, warning (test chụp logger và quét theo giá trị của fixture) |
| AC-12 | `lac_mode = shadow` không thêm lời gọi model nào (đếm `enqueueSubStep`), `content_preview.lac` có đủ số đếm |

## 8. Task cards

### T-LAC-01 — Hợp đồng LAC
- Files: `lib/loan-dossier/context/types.ts`, `lib/loan-dossier/context/schema.ts` (zod), `lib/loan-dossier/catalog/field-labels.ts`, `app/loan-appraisal-v2/lib/dossier-view.ts`, `tests/loan-dossier/context-contract.test.ts`
- Refs: §4, LAC-R01, LAC-R07
- Làm: kiểu và zod schema của §4; `LAC_VERSION`; chuyển `FIELD_LABELS` / `labelOf` xuống `lib/` (re-export từ `dossier-view.ts`).
- DoD: schema parse được LAC dựng tay tối thiểu; từ chối `trust` / `gap` lạ; test hiện có của `tests/loan-appraisal-v2` về nhãn chạy không đổi.

### T-LAC-02 — Gộp chủ thể khoản vay và hộ kinh doanh
- Depends: T-LAC-01
- Files: `lib/loan-dossier/context/subjects.ts`, `tests/loan-dossier/context-subjects.test.ts`
- Refs: LAC-R02, LAC-R03, AC-3
- Làm: dựng `subjects` từ S3 + ledger; gộp `loan:*`, `business:*`, nhập Claim trùng (`field`, `value_norm`), tính lại `trust` cho chủ thể đã gộp. Không sửa `buildClaimLedger`: gộp ở lớp LAC để sổ Claim và `claims-store` giữ nguyên.
- DoD: AC-3; người / tài sản giữ nguyên mã S3.

### T-LAC-03 — Dữ kiện, trạng thái, mâu thuẫn, khoảng trống
- Depends: T-LAC-02
- Files: `lib/loan-dossier/context/build.ts`, `tests/loan-dossier/context-build.test.ts`
- Refs: LAC-R04…R10, LAC-R12, AC-1, AC-2, AC-4
- Làm: `buildLoanApplicationContext`; nhãn từ `doc_schemas`; quan hệ + `support_fact_ids`; `conflicts`; `gaps`; `meta.source_hash`.
- DoD: AC-1, AC-2, AC-4.

### T-LAC-04 — Render và bảng mã
- Depends: T-LAC-03
- Files: `lib/loan-dossier/context/render.ts`, `lib/loan-dossier/context/scope.ts`, `tests/loan-dossier/context-render.test.ts`
- Refs: LAC-R11, LAC-R12, LAC-R14, LAC-R15, §6.1, AC-5, AC-8, AC-9
- Làm: `promptContextScope(checks)` (khóa `lac.*` + ánh xạ khóa cũ); `renderLoanApplicationContext` → `{ text, refIndex, stats }`; ngân sách theo thứ tự ưu tiên.
- DoD: AC-5, AC-8, AC-9; snapshot text của 2 fixture (HKD, SME) được review tay.

### T-LAC-05 — Nối vào Rule LLM
- Depends: T-LAC-04
- Files: `lib/pipelines/workflows/loan-appraisal/prompt-checks.ts`, `lib/pipelines/workflows/loan-appraisal.ts`, `tests/loan-appraisal/prompt-checks-lac.test.ts`
- Refs: LAC-R13, LAC-R16, LAC-R17, §6.2, AC-6, AC-7, AC-10, AC-12
- Làm: placeholder `{{context}}`, template mặc định mới, tham số `lac_mode`; `resolveContextRefs` cạnh `resolveEvidenceRefs`; rào trạng thái; `reason_code` mới `PROMPT_CHECK_EVIDENCE_DISPUTED`, `PROMPT_CHECK_DECLARED_ONLY` (khai cạnh các mã `PROMPT_CHECK_*` hiện có, kèm ánh xạ trong `check-contract.ts` cho payload tích hợp); thống kê shadow.
- DoD: AC-6, AC-7, AC-10, AC-12; test hiện có của `prompt-checks` chạy không đổi ở `lac_mode = off`.

### T-LAC-06 — Lưu trữ, an toàn, tài liệu
- Depends: T-LAC-05
- Files: `lib/pipelines/workflows/loan-appraisal/types.ts`, `lib/pipelines/workflows/loan-appraisal.ts`, `lib/pipelines/workflows/loan-appraisal/README.md`, `tests/loan-appraisal/lac-pii.test.ts`
- Refs: LAC-R18, LAC-R19, AC-11
- Làm: `loan_application_context_summary` trong kết quả; test quét PII; cập nhật README (mục Rule LLM) và trang cấu hình (khóa `lac.*` trong gợi ý `input`).
- DoD: AC-11.

### T-LAC-07 — Đo trên UAT và quyết định bật
- Depends: T-LAC-05
- Files: `scripts/lac-shadow-report.ts` (không commit dữ liệu hồ sơ), báo cáo trong `docs/loan-appraisal/uat-analysis/`
- Làm: chạy bộ hồ sơ UAT hai lần (`off`, `on`) với cùng model. So sánh theo rule: phân bố `PASS`/`REVIEW`/`FAIL`/`INSUFFICIENT_DATA`, số dẫn chiếu bị rào loại (`EVIDENCE_MISSING`, `NOT_ACCEPTED`), số kết quả khác nhau giữa hai chế độ (CO chấm tay xem bên nào đúng), độ dài prompt, token.
- **Tiêu chí bật `on` làm mặc định:** (1) tỉ lệ dẫn chiếu bị loại giảm; (2) trên các kết quả khác nhau, CO đánh giá LAC đúng ≥ đường cũ; (3) không có `PASS` sai mới nào ở rule định danh (`BORROWER_IDENTITY`, `OWNER_MATCH`); (4) prompt không dài hơn đường cũ quá 10%.

## 9. Điểm cần quyết

| ID | Câu hỏi | Mặc định đề xuất | Ai quyết |
|---|---|---|---|
| **OQ-LAC-01** | Rào `DECLARED_ONLY` (LAC-R13) có quá chặt với rule mà lời khai là đủ (hạn mức, mục đích vay) không | Bật rào; rule khai `allow_declared_pass: true` để miễn. Ba rule LLM mặc định không miễn | BA + Risk |
| **OQ-LAC-02** | Một hồ sơ có thể có nhiều hộ kinh doanh / nhiều nguồn thu nhập kinh doanh (vợ và chồng mỗi người một HKD) | v1 một chủ thể `business-1`; thu nhập kinh doanh theo người vẫn ở fact của người (`income_sources`) | BA |
| **OQ-LAC-03** | Có cho rule engine deterministic và đầu vào tài chính (stage 2) đọc LAC thay `EvidenceRegistry` / `financialInputsV3` không | Không ở v1. Chỉ Rule LLM; đánh giá sau T-LAC-07 | Dev lead |
| **OQ-LAC-04** | Payload tích hợp (schema 5.x) có cần mang LAC (hoặc `conflicts` / `gaps`) cho hệ thống ngoài không | Không ở v1; `checks[].evidence_ids` vẫn là `record_id` | PO + hệ thống gọi |
| **OQ-LAC-05** | Khi bật lại S4/S5 và `master_dossier`, giá trị `OCR_NORMALIZED` / `CORRECTED` có phủ lên `trust` của fact không | Có: fact của trường đã hiệu chỉnh mang thêm `corrected_from_fact_ids`, `trust` giữ nguyên, `review = REVIEW` (cùng tinh thần MD-R19) | Dev lead + BA |
| **OQ-LAC-06** | Có dùng LAC cho các bước LLM khác (precheck giai đoạn 1 chưa có S2/S3; `intake_review` khi bật lại) | Precheck: không (chưa có S2). `intake_review`: có, khi bật lại | Dev lead |
| **OQ-LAC-07** | Có giữ khối OCR thô `{{evidence}}` làm phụ lục khi `on` (cho trường mà LAC không render, VD bảng CIC dài) | Không; fact `doc-<n>` trong `CHỨNG TỪ KHÁC` thay thế. Xem lại sau T-LAC-07 nếu `INSUFFICIENT_DATA` tăng | Dev lead |
