# Master data chuẩn hóa theo checklist (`master_dossier`)

> Trạng thái: **đã cài đặt** (IMPLEMENT D-44, D-46; lệch so với bản đề xuất ghi ở V-25). **MD-R15…R20 (hiệu chỉnh bằng LLM, D-67) đang thực hiện: PLAN Phần C.** Áp dụng trên workflow v2 ([v2_integration.md](v2_integration.md)); khi mâu thuẫn với V2-R05…V2-R07 về nguồn dữ liệu của rule, file này thắng sau khi được duyệt.

## 1. Mục đích

Hiện mỗi rule (engine, LLM, tài chính) đọc thẳng từng bản OCR (`EvidenceRegistry`, V2-R04). Một bản đọc sai làm sai mọi rule dùng bản đó. Ví dụ UAT: GCN của asset-1 có 3 bản, 2 bản đọc Số vào sổ "CN 6475", 1 bản đọc "CH.6475"; mọi nơi dùng bản thứ ba đều thấy giá trị sai. Master data hiện tại (`buildMasterDataFromS3`, D-42, đã gỡ ở D-66) chỉ có định danh người và tài sản, chỉ để hiển thị.

`master_dossier` là **một bản hồ sơ đã hợp nhất, đặt theo checklist**:
- mỗi mục checklist áp dụng cho chương trình + luồng (S4-R24) có một mục master, kể cả mục còn thiếu chứng từ;
- mỗi mục có một **chứng từ hợp nhất**: các bản trùng của cùng chứng từ được gom, mỗi trường lấy giá trị thống nhất, lỗi đọc 1 ký tự được chuẩn hóa theo đa số, trường không thống nhất được giữ ở trạng thái xung đột;
- người và tài sản có trường đã hợp nhất giữa các chứng từ khác nhau, theo kết quả S5;
- rule engine, Rule LLM, tài chính và (sau này) AI Agent đọc `master_dossier` thay cho từng bản OCR.

## 2. Phạm vi

| Làm | Không làm |
|---|---|
| Hàm thuần dựng `master_dossier` từ output S2…S5, chạy cuối stage 2 | Hàm dựng không gọi model; không thêm stage. Hiệu chỉnh bằng một lời gọi LLM riêng, sau khi dựng (MD-R15…R20, D-67) |
| Hợp nhất bản trùng cùng chứng từ, chuẩn hóa lỗi đọc theo đa số | **Không sửa** `data` gốc của EvidenceEnvelope; bản lệch vẫn giữ nguyên để truy vết |
| Hợp nhất trường người/tài sản giữa các chứng từ theo S5 | Không thay S5: đối chiếu chéo vẫn so các bản gốc với nhau |
| Rule đọc `master.*`; prompt LLM nhận khối master | Không tự chọn giá trị khi các bản xung đột và chưa đủ căn cứ (cổng G1…G4 của MD-R15); khi đủ thì LLM chọn một trong các giá trị đã đọc và phải qua kiểm tra V1, V2 (MD-R16) |
| Hiển thị master theo checklist; xuất trong output 3.0 và payload | Không cho sửa master trên giao diện (không có bản vá OCR trên v2) |

## 3. Vị trí trong luồng

```
stage 1  S2 extract_evidence ── evidences[] (+ duplicate_group_id, S2-R18)
stage 2  S3 map_dossier_roles ── role_registry, customer_360, asset_registry, superseded_evidences
         S4 check_checklist   ── items[] (item_key × người/tài sản, status, found_in[])
         S5 cross_check       ── results[] (MATCH / NEAR_MATCH / MISMATCH / UNDETERMINED)
         MD build_master_dossier (mới, thuần) ── master_dossier
stage 3–7 tài chính, 5C, rule engine, Rule LLM, khuyến nghị ── đọc master_dossier
```

`build_master_dossier` chạy lại mỗi lần resume như `buildEvidenceRegistryV3` (không lưu checkpoint riêng); lỗi trong hàm → `master_dossier = null`, `config_snapshot.warnings` ghi lý do, stage 3–7 quay về đọc `EvidenceRegistry` như hiện nay.

## 4. Mô hình dữ liệu

```ts
interface MasterDossier {
  master_version: '1.0';
  program_key: string; product_code: string; flow: string | null;
  documents: MasterDocument[];        // 1 dòng / dòng S4 có requirement khác null (MD-R02)
  other_documents: MasterDocument[];  // evidence SUCCESS không thuộc mục checklist nào (MD-R03)
  persons: MasterEntity[];            // theo S3 customer_360 (MD-R08)
  assets: MasterEntity[];             // theo S3 asset_registry (MD-R08)
  summary: { documents_total: number; documents_present: number; fields_total: number;
             agreed: number; ocr_normalized: number; single_source: number; conflict: number; missing: number; corrected: number };
}

interface MasterDocument {
  document_id: string;                // "mdoc-<n>", ổn định theo thứ tự MD-R12
  item_key: string | null;            // null ở other_documents
  item_label: string | null;
  checklist_group: string | null;
  required: boolean | null;
  checklist_status: string | null;    // status của dòng S4 (PRESENT, MISSING, NEEDS_RESCAN…)
  doc_type_key: string | null;        // loại thực sự dùng (kể cả loại thay thế khi SUBSTITUTED)
  doc_type_label: string | null;
  person_id: string | null; asset_id: string | null;
  copies: Array<{
    evidence_id: string; file_name: string; page_range: [number, number];
    role: 'PRIMARY' | 'DUPLICATE' | 'SUPERSEDED' | 'EXCLUDED';
    excluded_reason: string | null;   // VD FORM_NOT_FOUND (S4-R26), UNREADABLE_CONTENT
  }>;
  fields: MasterField[];              // rỗng khi không có bản dùng được
}

interface MasterField {
  path: string;                       // đường dẫn trong data, VD "assets[0].identifiers.certificate_book_number"
  label: string;
  kind: 'code' | 'id' | 'plate' | 'name' | 'text' | 'address' | 'money' | 'number' | 'date' | 'enum' | 'boolean';
  value: unknown | null;              // null khi MISSING; CONFLICT của chứng từ → null, của người/tài sản → giá trị canonical (MD-R08)
  status: 'AGREED' | 'OCR_NORMALIZED' | 'SINGLE_SOURCE' | 'CONFLICT' | 'MISSING' | 'CORRECTED'; // CORRECTED: MD-R17 (D-67)
  review_status: 'ACCEPTED' | 'REVIEW';
  confidence: number | null;          // min confidence (field cấp 1) của các bản ủng hộ value
  sources: string[];                  // evidence_id record (V2-R04) ghi đúng value
  candidates: Array<{ value: unknown; evidence_ids: string[] }>; // ≥ 2 khi CONFLICT
  outliers: Array<{ evidence_id: string; raw_value: unknown; reason_code: 'PROBABLE_OCR_ERROR' }>;
  note: string | null;
  correction?: { method: 'LLM_SELECTED_CANDIDATE'; proposal_id: string; original: { status: string; value: unknown };
                 distance: number; minority: Array<{ evidence_id: string; raw_value: unknown }>; reason: string }; // chỉ khi CORRECTED (MD-R17)
}

interface MasterEntity {
  entity_id: string;                  // person-n / asset-n của S3
  label: string;                      // "Khách hàng vay · NGUYỄN THỊ KIỀU ANH", "TSBĐ · Bất động sản (asset-1)"
  fields: Array<MasterField & { canonical_doc_type_key: string | null; cross_check_result_id: string | null }>;
  document_ids: string[];             // mdoc-* gắn với người/tài sản này
}
```

Enum mới cho `03_catalogs/enums.json` (T-MD-01): `MasterFieldStatus`, `MasterCopyRole`.

## 5. Rule

| ID | Rule |
|---|---|
| **MD-R01** | `build_master_dossier(evidences, s3, s4, s5)` là hàm thuần, tất định: cùng đầu vào → cùng output (kể cả thứ tự, `document_id`). Không gọi model, không đọc DB, không log giá trị trường (PII) |
| **MD-R02** | **Phủ checklist:** mỗi dòng `items[]` của S4 là một `MasterDocument` (cùng `item_key`, `person_id`, `asset_id`, `required`, `checklist_status`). Dòng `NOT_APPLICABLE` vẫn có mặt (để rule biết là không áp dụng). Mục checklist có `requirement = null` cho luồng (không áp dụng) không có trong `items[]` nên không có dòng. Dòng `MISSING` có `copies = []`, `fields = []` |
| **MD-R03** | Bản của mục = `found_in[]` của dòng S4 (gom theo `evidence_id`). Evidence `SUCCESS` không nằm trong `found_in` của dòng nào → `other_documents`, gom theo (`doc_type_key`, `duplicate_group_id` hoặc chính evidence) |
| **MD-R04** | **Vai trò bản:** bản trong `superseded_evidences` của S3 (S3-R27) → `SUPERSEDED`; bản `ERROR` hoặc nhận nhầm loại (`FORM_NOT_FOUND`, S4-R26) → `EXCLUDED` kèm `excluded_reason`; chỉ gộp các bản của **cùng một chứng từ** (cùng loại + cùng `duplicate_group_id`, S2-R18); mục có nhiều cụm (VD 2 báo cáo CIC khác ngày) → chọn cụm theo loại ưu tiên của mục, ngày cấp mới nhất, nhiều bản hơn, thứ tự S2; cụm còn lại `EXCLUDED`/`OTHER_INSTANCE`. Trong cụm được chọn: bản có confidence trung bình field cấp 1 cao nhất (hòa → thứ tự S2) là `PRIMARY`, các bản khác `DUPLICATE`. Chỉ `PRIMARY` + `DUPLICATE` tham gia hợp nhất |
| **MD-R05** | **Hợp nhất trường giữa các bản của cùng chứng từ** (theo lá `data`, sắp mảng như S2-R18; bỏ lá phạm vi chụp): (a) bỏ giá trị null; không còn giá trị → `MISSING`; (b) chỉ 1 bản có giá trị → `SINGLE_SOURCE`; (c) mọi giá trị trùng sau chuẩn hóa theo `kind` (MD-R06) → `AGREED`, `value` = dạng nguyên văn của `PRIMARY` nếu có, không thì của bản đầu; (d) `kind ∈ {code, plate}`, đúng 2 giá trị, ≥ 2 bản ghi giá trị đa số, đúng 1 bản lệch đúng 1 ký tự, cả hai dài ≥ 6 → `OCR_NORMALIZED`, `value` = đa số, bản lệch vào `outliers` (`PROBABLE_OCR_ERROR`) — cùng điều kiện S2-R18 (b) và S5-R07; (e) `kind = name`, khác nhau chỉ vì có bản không dấu và các bản có dấu chỉ 1 cách viết → `AGREED`, `value` = bản có dấu, `note` ghi lý do (cùng điều kiện D-38); (f) còn lại: nếu chỉ một phía có confidence ≥ 0.80 → `value` = giá trị của phía đó, `status = SINGLE_SOURCE`, `review_status = REVIEW`, `candidates` liệt kê đủ; nếu ≥ 2 giá trị đều có confidence ≥ 0.80 → `CONFLICT`, `value = null`, `candidates` đủ mọi giá trị. **Không** chọn theo đa số ở trường hợp (f) |
| **MD-R06** | **Chuẩn hóa để so** (chỉ dùng để so, `value` giữ dạng nguyên văn): `code` — `K(v)` của S3-R14 (bỏ khoảng trắng, dấu câu, HOA); `id` — chỉ chữ số; `plate` — như S5; `name`/`text` — NFC, HOA, gộp khoảng trắng; `address` — như S5 (`full_text`, HOA, dấu câu, khoảng trắng; không tra địa giới, D-35); `money`/`number` — số; `date` — ISO; `enum`/`boolean` — nguyên giá trị. `kind` suy từ tên field (quy ước đặt tên của `doc_schemas`) + kiểu giá trị (`fieldKind`), có test phủ lá mẫu của 47 loại |
| **MD-R07** | `review_status = ACCEPTED` khi `status ∈ {AGREED, OCR_NORMALIZED, SINGLE_SOURCE}` và `confidence ≥ 0.80`; ngược lại `REVIEW`. `OCR_NORMALIZED` luôn có `note` nêu mẫu biểu + file + trang của bản lệch |
| **MD-R08** | **Người và tài sản:** mỗi `customer_360[]` / `asset_registry[]` của S3 là một `MasterEntity`. Trường của thực thể lấy từ dòng S5 cùng `person_id`/`asset_id` + `field_group`/`sub_field`: `MATCH` → `AGREED`; `NEAR_MATCH` → `OCR_NORMALIZED` (giá trị đa số); `MISMATCH`/`UNDETERMINED` → `CONFLICT`, `value` = giá trị của `canonical_source` S5 nếu có (thứ bậc chứng từ của ma trận), `review_status = REVIEW`, `cross_check_result_id` trỏ dòng S5. Trường không có dòng S5 (chỉ 1 chứng từ) → lấy từ `MasterDocument` của chứng từ đó. Giá trị đọc từ `MasterDocument` (đã hợp nhất bản trùng), không đọc bản OCR lẻ |
| **MD-R09** | Thực thể tài sản có loại, mục đích, định danh, giá trị định giá mới nhất (cùng cách chọn với V2-R06). `master_data_provenance` (V2-R05, D-42) đã gỡ (D-66); `master_dossier` là nguồn duy nhất của master data người và tài sản |
| **MD-R10** | **Nguồn rule:** thêm `input: master.document.<item_key>` (mục phải có trong checklist catalog), `master.person`, `master.asset`. Khi có `master_dossier`, `input: evidence.<doc_type_key>` chọn **chứng từ hợp nhất** của loại đó (không còn chọn từng bản OCR), nên rule cũ trên Profile không phải sửa. **Rule engine:** đầu vào tài chính bị bỏ vì trường `CONFLICT` (MD-R13) → rule hạn mức/DSCR/LTV ra `REVIEW`/`INPUT_VALUE_CONFLICT` (không `FAIL`, không `PASS`), `message` nêu trường; `OCR_NORMALIZED` dùng `value` bình thường |
| **MD-R11** | **Rule LLM / AI Agent:** khối dữ liệu trong prompt dựng từ master: mỗi chứng từ hợp nhất là một khối `D<n>` (giữ định dạng tham chiếu hiện có để prompt ghi đè trên Profile vẫn đúng), nhãn khối = tên mục + `document_id`; người/tài sản là khối riêng. Trường `CONFLICT` hiện "CHƯA THỐNG NHẤT giữa các bản: …" kèm mọi `candidates` với mẫu biểu + file. Model trả `D<n>:<path>`; DUGATE đổi về lá nguồn thật (evidence record V2-R04) trước khi lưu; ref không có trong khối → bỏ. Một lá dùng ở nhiều trường giữ trạng thái thận trọng nhất (`REVIEW` thắng). Chỉ gửi mục/trường mà rule khai trong `input[]` |
| **MD-R12** | Thứ tự: `documents` theo thứ tự dòng S4; `other_documents` theo thứ tự evidence S2; `fields` theo thứ tự lá trong schema; `document_id` đánh số liên tục `mdoc-1…` qua `documents` rồi `other_documents` |
| **MD-R13** | **Tài chính (V2-R06):** đầu vào đọc từ `master_dossier` (số tiền vay, kỳ hạn, lãi suất, nợ hiện hữu từ mục giấy đề nghị vay; doanh thu/lợi nhuận từ mục bảng kê thu nhập; giá trị TSBĐ từ thực thể tài sản). Trường `CONFLICT`/`MISSING` → chỉ số phụ thuộc `INSUFFICIENT_DATA` kèm cảnh báo nêu trường |
| **MD-R14** | **Output & payload:** `AppraisalResultV2.master_dossier` (output 3.0, V2-R09) có đủ shape ở §4. Payload tích hợp chỉ mang bản chiếu tối thiểu (D-66, `briefMasterDossier`): mỗi trường `{ path, label, value, status, needs_review, candidates?, note? }` (`candidates` là giá trị, chỉ khi `CONFLICT`); `documents[]` chỉ gồm chứng từ có trường, không có `other_documents`; `persons` / `assets` chỉ `{ entity_id, label, fields }`; `summary` giữ nguyên. Giao diện `/loan-appraisal-v2` hiển thị master theo nhóm checklist → mục → bảng trường, nhãn trạng thái: Thống nhất / Đã chuẩn hóa (nghi lỗi đọc) / Một nguồn / Chưa thống nhất / Thiếu; mục `MISSING` hiện "Chưa có chứng từ" |
| **MD-R15** | **Hiệu chỉnh (D-67, D-68; nới ở D-92) — cổng chọn trường.** Sau khi dựng master (MD-R01), duyệt mọi trường của `documents`, `other_documents`, `persons`, `assets` có `status = CONFLICT` và `kind ∈ {code, id, plate, name, date}`. Trường thành **ứng viên hiệu chỉnh** (chỉ để quyết định có gửi LLM hay không, không quyết định giá trị) khi đủ: (G2) mọi nhóm giá trị theo khóa so (MD-R06) cách nhóm được ủng hộ nhiều nhất (số `evidence_id` khác nhau, hòa thì độ tin cậy cao hơn) 1–2 ký tự (Levenshtein trên khóa so); riêng `name` nới tới `⌊0,25 × độ dài khóa ngắn hơn⌋` nếu lớn hơn 2; (G3) khóa dài nhất ≥ 6 (`code`, `id`, `plate`) hoặc ≥ 8 (`name`, `date`); số nhóm khác nhau 2…4. **G1 (đa số tuyệt đối ≥ 2 chứng từ) và G4 (bản lệch cùng một loại tài liệu) đã bỏ:** hai cổng đó loại cả trường chỉ có hai bản (1 đối 1) — dạng xung đột phổ biến nhất — dù ở giai đoạn 2 hồ sơ nhìn chung đã chính xác và xung đột chủ yếu là lỗi đọc OCR. Việc chọn nằm ở LLM (MD-R16), có thể `KEEP_CONFLICT`. Không đủ G2, G3 → giữ `CONFLICT`, không gửi LLM |
| **MD-R16** | **Hiệu chỉnh — LLM chọn trong các giá trị đã đọc (D-68, D-69).** Có ứng viên hiệu chỉnh thì chạy **đúng một** lời gọi LLM (step key `master_correction`; model và reasoning mặc định lấy của `evaluate`) ở giai đoạn 2, sau khi dựng master (S3–S5). Prompt chứa, cho mỗi ứng viên: mã (`proposal_id`), nhãn trường, loại giá trị và danh sách lựa chọn `option_id` (`o1`, `o2`…), mỗi lựa chọn là một giá trị đã đọc (nguyên văn) kèm mẫu biểu · file · trang, độ tin cậy, số nguồn, `la_chung_tu_chuan` (lựa chọn có trên chứng từ gốc `canonical_doc_type_key` của trường người / tài sản) và `dung_dinh_dang` (CCCD 9 hoặc 12 số, ngày có thật; `null` nếu không kiểm tra được) của từng nguồn; dữ liệu gói trong `untrusted_*` và đoạn chống prompt injection. Model trả `{ decisions: [{ proposal_id, action: "SELECT" \| "KEEP_CONFLICT", option_id: string \| null, reason: string ≤ 200 }] }`: model **chỉ chọn `option_id`, không trả giá trị**. **Kiểm tra tất định sau LLM, không đạt → coi như `KEEP_CONFLICT`:** (V1) `proposal_id` có trong danh sách gửi (quyết định đầu tiên của mỗi mã được dùng); (V2) `action = SELECT` thì `option_id` thuộc danh sách lựa chọn của đúng ứng viên đó. Giá trị áp dụng vì vậy luôn là nguyên văn của một giá trị đã đọc. Không có ứng viên → không gọi LLM. Lỗi LLM hoặc phản hồi sai định dạng → không hiệu chỉnh trường nào, ghi cảnh báo (không chứa giá trị trường), stage không đổ. Tắt bằng tham số `master_correction = false` (mặc định true) |
| **MD-R17** | **Hiệu chỉnh — áp dụng.** `SELECT` hợp lệ → trường thành `status = CORRECTED`, `value` = nguyên văn lựa chọn, `review_status = REVIEW` (giữ mức rà soát dù độ tin cậy cao), `sources` = lá nguồn của lựa chọn, `confidence` = min độ tin cậy các lá đó (null nếu có lá chưa biết), `candidates` giữ nguyên, `outliers = []`, `note` nêu các giá trị bị thay (mẫu biểu · file · tr.). Thêm khối `correction = { method: "LLM_SELECTED_CANDIDATE", proposal_id, original: { status, value }, distance, minority: [{ evidence_id, raw_value }], reason }`: `distance` = khoảng cách lớn nhất giữa khóa so của lựa chọn và các lựa chọn còn lại; `minority` = lá nguồn của các lựa chọn còn lại. Chỉ áp dụng khi trường vẫn đang `CONFLICT`. `data` gốc của EvidenceEnvelope, dòng S4 và dòng S5 **không đổi** (S5 vẫn so các bản gốc) |
| **MD-R18** | **Hiệu chỉnh — tất định và checkpoint.** `buildMasterDossier` giữ nguyên MD-R01 (không gọi model). Hiệu chỉnh là hai hàm thuần `proposeMasterCorrections(master, evidences)` và `applyMasterCorrections(master, proposals, decisions)` (hàm sau chạy V1, V2). Quyết định của LLM lưu ở checkpoint bước 2 (`master_correction`, cùng cách với `intake_llm` của D-59) nên resume không gọi lại LLM: cùng master gốc + cùng checkpoint → master cuối giống hệt. Cache chỉ dùng khi tập `proposal_id` hiện tại bằng tập đã lưu. `proposal_id = "mc-" + sha256(scope \| thứ tự trường \| path \| các khóa so đã sắp xếp)[0:12]` với `scope` là `document_id` hoặc `entity_id` |
| **MD-R19** | **Hiệu chỉnh — mọi bước sau đọc giá trị đã hiệu chỉnh.** (a) Registry Rule LLM (MD-R11) và rule engine (MD-R10) dùng `value` như `OCR_NORMALIZED`, kèm `review_status = REVIEW`; (b) đầu vào tài chính (MD-R13) dùng `value`, không đặt cờ xung đột; (c) Customer 360 kiểu cũ đưa cho Rule LLM (`master_data.*`) lấy `identity.*` và `identifiers.*` từ trường đã hiệu chỉnh của `persons` / `assets`; (d) tiêu chí 2 của `intake_assessment`: dòng S5 hoặc `COPY_CONFLICT` ứng với trường đã hiệu chỉnh không còn là điểm cần kiểm tra mà vào danh sách đã khớp với ghi chú "đã hiệu chỉnh theo đa số, cần xác nhận" (cùng cách với `NEAR_MATCH`); (e) output, payload tối thiểu (qua `status` và `note`) và giao diện hiện nhãn "Đã hiệu chỉnh (cần xác nhận)" và giá trị lệch. `customer_360` của S3, `cross_check` và `checklist` giữ nguyên để CO thấy sai lệch gốc (OQ-33) |
| **MD-R20** | **Hiệu chỉnh — phạm vi v1 và an toàn.** Chỉ `kind ∈ {code, id, plate, name, date}`; không hiệu chỉnh `money`, `number`, `address`, `text`, `enum`, `boolean` (OQ-31); không đọc lại ảnh (OQ-32). Trường ở trạng thái khác `CONFLICT` (kể cả `OCR_NORMALIZED` cách 1 ký tự, D-41) giữ như MD-R05. Prompt chứa giá trị định danh (CCCD, số GCN…) gửi tới cùng cổng model đã nhận master của Rule LLM (MD-R11); không log giá trị trường hay prompt (PII). `summary` thêm `corrected` (số trường `CORRECTED` của `documents` + `other_documents`) |

## 6. Acceptance criteria

| ID | Given / When / Then | Rule |
|---|---|---|
| MD-AC01 | Given 3 bản GCN cùng nhóm trùng, Số vào sổ "CN 6475", "CN 6475", "CH.6475" / Then trường `OCR_NORMALIZED`, `value = "CN 6475"`, `outliers` có bản "CH.6475", `note` nêu mẫu biểu + file + trang | MD-R05, MD-R07 |
| MD-AC02 | Given 2 bản cùng chứng từ, ngày sinh khác nhau, cả hai confidence 0.9 / Then `CONFLICT`, `value = null`, `candidates` có 2 giá trị | MD-R05 |
| MD-AC03 | Given CCCD "NGUYỄN THỊ KIỀU ANH" và CIC "NGUYEN THI KIEU ANH" / Then trường họ tên của người `AGREED`, `value` có dấu | MD-R05, MD-R08 |
| MD-AC04 | Given luồng FULL, mục định giá BĐS bắt buộc không có chứng từ / Then có `MasterDocument` `checklist_status = MISSING`, `copies = []` | MD-R02 |
| MD-AC05 | Given bản bị nhận nhầm loại (`FORM_NOT_FOUND`) và bản bị thay thế / Then hai bản có `role` `EXCLUDED`/`SUPERSEDED`, không góp giá trị | MD-R04 |
| MD-AC06 | Given S5 dòng số GCN `NEAR_MATCH` / Then trường số GCN của tài sản `OCR_NORMALIZED`, `value` = đa số | MD-R08 |
| MD-AC07 | Given S5 dòng địa chỉ `MISMATCH` / Then trường địa chỉ của người `CONFLICT`, `value` = giá trị `canonical_source`, `cross_check_result_id` trỏ dòng đó | MD-R08 |
| MD-AC08 | Given 2 bản đề nghị vay ghi `loan_info.bank_proposed_amount` khác nhau (cùng nhóm trùng) / Then trường `CONFLICT`, chỉ số số tiền vay `INSUFFICIENT_DATA` có `input_conflict`, rule hạn mức `REVIEW`/`INPUT_VALUE_CONFLICT`, không rule engine nào `FAIL` | MD-R10, MD-R13 |
| MD-AC09 | Given khối master `D1` và Rule LLM trả `evidence_ids = ["D1:<path>", "D99:x"]` / Then lưu lá nguồn thật của trường `D1:<path>`, bỏ `D99:x`; trường `CONFLICT` trong khối có chữ "CHƯA THỐNG NHẤT" | MD-R11 |
| MD-AC10 | Given cùng đầu vào chạy 2 lần / Then `master_dossier` giống hệt (JSON so từng byte) | MD-R01, MD-R12 |
| MD-AC11 | Given hồ sơ UAT không có bản trùng lệch nào / Then kết quả rule engine, 5C, chỉ số tài chính giống hệt trước khi đổi nguồn (hồi quy) | MD-R10, MD-R13 |
| MD-AC12 | Given `build_master_dossier` ném lỗi / Then `master_dossier = null`, có cảnh báo trong `config_snapshot.warnings`, stage 3–7 vẫn chạy bằng `EvidenceRegistry` | MD-R01 |
| MD-AC13 | Given số GCN của asset-1: giấy chứng nhận "AA 08798136", giấy đề nghị vay "AA 08798136", báo cáo định giá "AA 08798163" (cách 2 ký tự), LLM chọn lựa chọn của "AA 08798136" / Then trường số GCN `CORRECTED`, `value = "AA 08798136"`, `review_status = REVIEW`, `candidates` giữ cả hai giá trị, `correction.method = LLM_SELECTED_CANDIDATE`, `correction.minority` trỏ báo cáo định giá, `summary.corrected` tăng 1 (trường của chứng từ) | MD-R15, MD-R17, MD-R20 |
| MD-AC14 | Given ứng viên hợp lệ nhưng LLM trả `KEEP_CONFLICT`, hoặc lỗi, hoặc `master_correction = false` / Then trường giữ `CONFLICT`, không có `correction`, stage không đổ; lỗi LLM có cảnh báo không chứa giá trị | MD-R16, MD-R20 |
| MD-AC15 | Given 1 giá trị đối 1 giá trị, hoặc khoảng cách 3 ký tự, hoặc nhóm lệch đến từ 2 loại tài liệu, hoặc `kind = money` / Then không có đề xuất; không có đề xuất nào thì không gọi LLM | MD-R15, MD-R16, MD-R20 |
| MD-AC16 | Given LLM trả `SELECT` với `option_id` không thuộc ứng viên, hoặc `proposal_id` lạ, hoặc kèm một giá trị riêng ngoài các lựa chọn / Then bỏ qua, trường giữ `CONFLICT`; giá trị áp dụng luôn thuộc `candidates` | MD-R16, MD-R17 |
| MD-AC17 | Given checkpoint bước 2 đã có `master_correction` / When resume / Then không gọi LLM, `master_dossier` cuối giống hệt lần trước (JSON so từng byte) | MD-R18 |
| MD-AC18 | Given trường CCCD đã `CORRECTED` / Then registry Rule LLM mang giá trị đã sửa với `review_status = REVIEW`; Customer 360 cho Rule LLM mang giá trị đã sửa; tiêu chí 2 không còn điểm cần kiểm tra cho trường đó, có dòng "đã hiệu chỉnh" trong danh sách đã khớp | MD-R19 |

## 7. Task cards

### T-MD-01 — Hợp đồng `master_dossier`
- Depends: T-V2-03
- Files: `lib/loan-dossier/contracts/master-dossier.ts`, `tests/loan-dossier/md-contract.test.ts`
- Refs: MD-R01, MD-R12
- Làm: Zod schema strict cho `MasterDossier`, `MasterDocument`, `MasterField`, `MasterEntity` (§4); thêm `MasterFieldStatus`, `MasterCopyRole` vào `03_catalogs/enums.json` và đồng bộ sang code.
- DoD:
  - test: `CONFLICT` của chứng từ bắt buộc `value = null` và `candidates` ≥ 2
  - test: `OCR_NORMALIZED` bắt buộc ≥ 1 `outliers` và `note`
  - test: `MISSING` bắt buộc `value = null`, `sources = []`
- Verify: `npx jest tests/loan-dossier/md-contract.test.ts`

### T-MD-02 — Hợp nhất bản trùng của một chứng từ
- Depends: T-MD-01
- Files: `lib/loan-dossier/master/document.ts`, `tests/loan-dossier/md-document.test.ts`
- Refs: MD-R03, MD-R04, MD-R05, MD-R06, MD-R07
- Làm: Từ `items[]` S4, `found_in`, evidences S2, `superseded_evidences` S3: dựng `MasterDocument` (vai trò bản, hợp nhất trường theo MD-R05, `kind` theo MD-R06).
- DoD:
  - test: MD-AC01, MD-AC02, MD-AC04, MD-AC05
  - test: trường hợp (f) của MD-R05 — một phía confidence thấp → `SINGLE_SOURCE`/`REVIEW`
  - test: bảng `kind` phủ đủ 47 loại của `doc_types.json`
- Verify: `npx jest tests/loan-dossier/md-document.test.ts`

### T-MD-03 — Người và tài sản hợp nhất theo S5
- Depends: T-MD-02
- Files: `lib/loan-dossier/master/entity.ts`, `tests/loan-dossier/md-entity.test.ts`
- Refs: MD-R08, MD-R09
- Làm: Dựng `persons`, `assets` từ S3 + dòng S5 + `MasterDocument`; trường tài sản theo D-42.
- DoD:
  - test: MD-AC03, MD-AC06, MD-AC07
  - test: trường chỉ có 1 chứng từ lấy từ `MasterDocument` đã hợp nhất bản trùng
- Verify: `npx jest tests/loan-dossier/md-entity.test.ts`

### T-MD-04 — Chạy trong stage 2, output và payload
- Depends: T-MD-03, T-V2-08
- Files: `lib/pipelines/workflows/loan-appraisal.ts`, `lib/pipelines/workflows/loan-appraisal/integration-payload.ts`, `tests/loan-appraisal/v2-master-dossier.test.ts`
- Refs: MD-R01, MD-R09, MD-R14
- Làm: Gọi `buildMasterDossier` sau S5 mỗi lần resume; thêm `master_dossier` vào output 3.0 và payload; `master_data_provenance` suy từ master.
- DoD:
  - test: MD-AC10, MD-AC12
  - test: payload và output cùng shape `master_dossier`
- Verify: `npx jest tests/loan-appraisal/v2-master-dossier.test.ts`

### T-MD-05 — Giao diện master theo checklist
- Depends: T-MD-04, T-V2-09
- Files: `components/loan-appraisal-v2/intake/MasterDataPanel.tsx`, `app/loan-appraisal-v2/lib/master-view.ts`, `tests/loan-appraisal-v2/master-view.test.ts`
- Refs: MD-R14
- Làm: Hàm thuần gom master theo nhóm checklist → mục → trường, nhãn trạng thái; panel dùng hàm này.
- DoD:
  - test: nhãn 5 trạng thái đúng; mục `MISSING` hiện "Chưa có chứng từ"
  - test: `OCR_NORMALIZED` hiện bản lệch dạng mẫu biểu (file · tr.N)
- Verify: `npx jest tests/loan-appraisal-v2/master-view.test.ts`

### T-MD-06 — Rule engine đọc `master.*`
- Depends: T-MD-04, T-V2-07
- Files: `lib/pipelines/workflows/loan-appraisal/rules.ts`, `lib/pipelines/workflows/loan-appraisal/check-set.ts`, `tests/loan-appraisal/v2-rules-master.test.ts`
- Refs: MD-R10
- Làm: Nguồn `master.*` cho rule; chuyển các rule mặc định sang `master.*`; `CONFLICT`/`MISSING` → `REVIEW`.
- DoD:
  - test: MD-AC08, MD-AC11 (rule engine)
  - test: `master.document.<mục không có>` bị từ chối (fail-closed khi lưu Profile)
- Verify: `npx jest tests/loan-appraisal/v2-rules-master.test.ts`

### T-MD-07 — Prompt Rule LLM dùng khối master
- Depends: T-MD-04, T-V2-07
- Files: `lib/pipelines/workflows/loan-appraisal/prompt-checks.ts`, `tests/loan-appraisal/v2-prompt-master.test.ts`
- Refs: MD-R11
- Làm: Khối `M<n>:<path>` thay cho khối evidence; ánh xạ ref về evidence record; trường `CONFLICT` kèm mọi ứng viên.
- DoD:
  - test: MD-AC09
  - test: `master.document.<item_key>`, `master.person`, `master.asset` được nhận và lọc đúng phạm vi
- Verify: `npx jest tests/loan-appraisal/v2-prompt-master.test.ts`

### T-MD-08 — Đầu vào tài chính từ master
- Depends: T-MD-04, T-V2-06
- Files: `lib/pipelines/workflows/loan-appraisal/financial-inputs.ts`, `tests/loan-appraisal/v2-financial-master.test.ts`
- Refs: MD-R13
- Làm: Đọc số tiền vay, kỳ hạn, lãi suất, nợ hiện hữu, doanh thu/lợi nhuận, giá trị TSBĐ từ `master_dossier`.
- DoD:
  - test: trường `CONFLICT` → chỉ số phụ thuộc `INSUFFICIENT_DATA` kèm cảnh báo
  - test: MD-AC11 (tài chính, 5C)
- Verify: `npx jest tests/loan-appraisal/v2-financial-master.test.ts`

### T-MD-09 — Hợp đồng `CORRECTED` và đề xuất hiệu chỉnh
- Depends: T-MD-03
- Files: `lib/loan-dossier/contracts/master-dossier.ts`, `lib/loan-dossier/master/correct.ts`, `lib/loan-dossier/master/build.ts`, `docs/loan-appraisal/spec-v3/03_catalogs/enums.json`, `lib/loan-dossier/catalog/data/enums.json`, `tests/loan-dossier/md-correct.test.ts`, `tests/loan-dossier/md-document.test.ts`
- Refs: MD-R15, MD-R17, MD-R20
- Làm: Thêm `CORRECTED` vào `MasterFieldStatus` (catalog và code), khối `correction` tùy chọn, `summary.corrected`; ràng buộc zod: `CORRECTED` ⇒ có `correction`, `review_status = REVIEW`, `value` khác null, `outliers = []`. Viết `proposeMasterCorrections(master, evidences)` theo G1…G4.
- DoD:
  - test: MD-AC13 (đề xuất), MD-AC15 (1 đối 1, cách 3 ký tự, 2 loại tài liệu, `money`)
  - test: `CORRECTED` thiếu `correction` hoặc `review_status = ACCEPTED` bị từ chối
  - test: `proposal_id` ổn định giữa hai lần chạy
- Verify: `npx jest tests/loan-dossier/md-correct.test.ts tests/loan-dossier/md-document.test.ts`

### T-MD-10 — Áp dụng quyết định hiệu chỉnh
- Depends: T-MD-09
- Files: `lib/loan-dossier/master/correct.ts`, `tests/loan-dossier/md-correct.test.ts`
- Refs: MD-R17, MD-R18
- Làm: `applyMasterCorrections(master, proposals, decisions)` hàm thuần: chạy V1, V2 (MD-R16); `SELECT` hợp lệ ⇒ trường `CORRECTED` theo MD-R17; `KEEP_CONFLICT`, thiếu, lạ hoặc không qua V1, V2 ⇒ giữ nguyên; cập nhật `summary`.
- DoD:
  - test: MD-AC13 (áp dụng), MD-AC14, MD-AC16
  - test: cùng master + cùng quyết định cho kết quả giống từng byte
- Verify: `npx jest tests/loan-dossier/md-correct.test.ts`

### T-MD-11 — Lời gọi LLM, checkpoint, nối vào workflow
- Depends: T-MD-10, T-V2-08
- Files: `lib/pipelines/workflows/loan-appraisal/master-correction.ts`, `lib/pipelines/workflows/loan-appraisal/dossier-consolidate.ts`, `lib/pipelines/workflows/loan-appraisal.ts`, `lib/endpoints/registry.ts`, `tests/loan-appraisal/v2-master-correction.test.ts`
- Refs: MD-R16, MD-R18, MD-R20
- Làm: Prompt `master_correction` (LLM chọn `option_id`, MD-R16; placeholder bắt buộc, chống prompt injection, ghi đè qua Profile như `intake_review`), parse bằng zod, cache `master_correction` ở `ConsolidateCheckpoint`; gọi giữa bước dựng master và `buildIntakeAssessment`; tham số `master_correction` (mặc định true).
- DoD:
  - test: MD-AC14, MD-AC16, MD-AC17
  - test: không có ứng viên thì không gọi LLM
  - test: cảnh báo lỗi LLM không chứa giá trị trường
- Verify: `npx jest tests/loan-appraisal/v2-master-correction.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts`

### T-MD-12 — Các bước sau dùng giá trị hiệu chỉnh, giao diện
- Depends: T-MD-11
- Files: `lib/pipelines/workflows/loan-appraisal/master-dossier.ts`, `lib/pipelines/workflows/loan-appraisal/intake-assessment.ts`, `lib/pipelines/workflows/loan-appraisal.ts`, `app/loan-appraisal-v2/lib/master-view.ts`, `components/loan-appraisal-v2/intake/MasterDataPanel.tsx`, `tests/loan-appraisal/v2-master-correction-downstream.test.ts`, `tests/loan-appraisal-v2/master-view.test.ts`
- Refs: MD-R19
- Làm: Registry Rule LLM, đầu vào tài chính, Customer 360 cho Rule LLM đọc trường `CORRECTED`; tiêu chí 2 chuyển điểm tương ứng sang danh sách đã khớp; nhãn "Đã hiệu chỉnh (cần xác nhận)" và hiển thị giá trị lệch.
- DoD:
  - test: MD-AC18
  - test: trường `CONFLICT` chưa hiệu chỉnh vẫn ra điểm cần kiểm tra như cũ
  - test: nhãn trạng thái `CORRECTED` đúng, các nhãn cũ không đổi
- Verify: `npx jest tests/loan-appraisal/v2-master-correction-downstream.test.ts tests/loan-appraisal/v2-master-dossier.test.ts tests/loan-appraisal/v2-intake-assessment.test.ts tests/loan-appraisal-v2/master-view.test.ts`

## 8. Điểm cần quyết

Xem OQ-26…OQ-29 và OQ-30…OQ-33 (hiệu chỉnh, D-67) trong [open_questions.md](../open_questions.md).
