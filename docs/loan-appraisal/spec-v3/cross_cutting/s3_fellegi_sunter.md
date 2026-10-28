# Bộ chấm Fellegi-Sunter cho S3 (`s3_matcher`)

> Trạng thái: **ĐỀ XUẤT (D-109, 2026-10-27), chưa cài đặt.** Thay **bước so khớp party → người** của
> [S3](../stages/S3_map_dossier_roles.md) (S3-R06, S3-R07, S3-R08, S3-R09) bằng điểm Fellegi-Sunter (FS). Không đổi phần còn lại
> của S3: anchor và registry (S3-R01…R05), số định danh (S3-R11…R13), tài sản (S3-R14…R19), quan hệ, Customer 360.
> Bộ chấm viết bằng TypeScript thuần trong repo; tham số m/u đếm **ngoài hệ thống** từ bộ hồ sơ chuẩn có nhãn (§4) rồi nạp qua catalog JSON. Không dùng Splink (D-111).
> Không dùng thư viện FS trên npm: không có gói nào đủ chín, gói gần nhất có giấy phép AGPL.

## 1. Mục đích

S3 ghép party bằng luật theo thứ tự: khớp số định danh thì ghép (S3-R06); không có số, hoặc số không thuộc người nào, thì xét tên (S3-R07).
Luật này **không cộng bằng chứng của nhiều trường**, nên sai ở các ca sau. Kết quả chạy `runMapDossier` thật trên fixture dựng tay
(2026-10-27); khách vay trên đơn vay: `NGUYỄN VĂN HÙNG`, số `001090000001`, sinh 1990-05-01; mỗi ca thêm một CCCD:

| # | CCCD thêm vào | S3 hiện tại | FS (tham số §3.4; chỉ tính số, tên, ngày sinh, giới tính) |
|---|---|---|---|
| 1 | Cùng tên, **khác số, khác ngày sinh** (cha / con trùng tên) | **Gộp vào khách vay** theo tên; chỉ gắn `DECLARED_ID_DIFFERS` | Không ghép, W ≈ −4,4 |
| 2 | Tên khác dấu, không số, cùng ngày sinh và giới tính | Không ghép (`NAME_SPELLING_DIFFERENCE`, S3-R08) | Ghép, W ≈ 18,8 |
| 3 | Số lệch 1 ký tự, tên và ngày sinh khớp | Gộp theo tên, gắn **cùng** `DECLARED_ID_DIFFERS` như ca 1 | Ghép, nhận ra số lệch 1 ký tự, W ≈ 30,5 (bỏ giới tính theo FS-R04) |
| 4 | Chỉ trùng tên, không số, không ngày sinh | Gộp, **không** gắn cờ soát | Cần soát, W ≈ 6,3 |
| 5 | Cùng số, tên sai dấu | Gộp (`ID_NUMBER`) | Ghép, W ≈ 37,7 |

Cột S3 là kết quả chạy thật; cột FS tính tay từ tham số §3.4 (bản thử ngày 2026-10-27 dùng tham số gần giống, cho cùng quyết định).
Thêm `permanent_address` và `id_structure` thì điểm đổi nhưng quyết định của 5 ca không đổi; FS-AC04 kiểm quyết định, không kiểm điểm.

Gộp nhầm (ca 1) lan sang mọi bước sau: checklist chấm sai người, Customer 360 trộn hai người, LAC báo mâu thuẫn giả. Ca 1 và ca 3 nhận
cùng một cờ, nên người duyệt không phân biệt được hai người khác nhau với một lỗi OCR.

## 2. Phạm vi

| Làm | Không làm |
|---|---|
| Chấm điểm party (cá nhân) với từng người trong registry; quyết định ghép / không ghép / cần soát | Không tạo người mới ngoài anchor (giữ S3-R01…R05) |
| Tham số m/u, ngưỡng trong catalog JSON có phiên bản | Không chạy EM trong worker; không gọi LLM |
| Chế độ `rules` / `shadow` / `fs` như `lac_mode` | Không đổi cách ghép pháp nhân (theo mã số thuế, S3-R06) ở v1 |
| Script đếm m/u từ bộ hồ sơ chuẩn có nhãn, dùng chính bộ so sánh TS | Không áp FS cho tài sản (S3-R14…R16) ở v1 |
| Vá ngay ca 1 bằng luật, độc lập với FS (FS-R01) | |

## 3. Mô hình

### 3.1 Cặp ứng viên

Mỗi party chưa ghép, `party_type = INDIVIDUAL`, có tên hoặc số (cùng tập đang xét ở `otherParties`), so với **mọi người**
`INDIVIDUAL` trong registry. Hồ sơ nhỏ (vài chục party, vài người) nên không cần blocking. Cá nhân không bao giờ so với pháp nhân.
Điểm của party với một người = **điểm cao nhất** giữa party đó và từng party đã gom vào người (anchor và đã ghép); riêng số định danh
so với cả tập `K(p)` (S3-R06).

### 3.2 Trường so sánh và mức

| Trường | Mức (theo thứ tự xét) | Ghi chú |
|---|---|---|
| `id_number` | `AGREE` (bằng nhau sau `normIdNumber`, hoặc thuộc `K(p)`) · `OLD_NEW` (một bên 9 số, một bên 12 số, `isOldNewPair`) · `NEAR` (cùng độ dài ≥ 9, khác đúng 1 ký tự) · `DISAGREE` · `MISSING` | `MISSING` khi một bên không có số, **hoặc** `field_confidences.parties < 0.50` (cùng ngưỡng S3-R06) |
| `full_name` | `EXACT` · `REORDERED` · `SPELLING_DIFFERENCE` · `NO_MATCH` (dùng nguyên `nameLevel`, S3-R07) · `MISSING` | |
| `date_of_birth` | `AGREE` · `DAY_MONTH_SWAPPED` (cùng năm, ngày và tháng đảo chỗ) · `DISAGREE` · `MISSING` | |
| `gender` | `AGREE` · `DISAGREE` · `MISSING` | Bỏ qua khi `id_number` là `AGREE` hoặc `NEAR` (FS-R04) |
| `permanent_address` | `AGREE` (cùng `full_text` chuẩn hóa) · `SAME_PROVINCE` · `DISAGREE` · `MISSING` | Trọng số thấp; địa chỉ trước / sau sáp nhập đơn vị hành chính 2025 chưa có bảng ánh xạ (OQ-FS-04) |
| `id_structure` (dẫn xuất) | `CONSISTENT` · `INCONSISTENT` · `NOT_APPLICABLE` | Số 12 chữ số của party mới so với ngày sinh, giới tính của người: chữ số thứ 4 mã hóa giới tính và thế kỷ sinh (0/1 nam/nữ thế kỷ 20, 2/3 nam/nữ thế kỷ 21), chữ số 5–6 là hai số cuối năm sinh |

### 3.3 Điểm và quyết định

- Trọng số của một trường ở mức `ℓ`: `w = log2(m_ℓ / u_ℓ)`; `MISSING` cho 0. Điểm cặp `W = Σ w`.
- Xác suất ghép: `P = 1 / (1 + 2^-(W + log2(λ / (1 − λ))))`, `λ` = `prior_match_probability` của catalog. `P` thay `match_confidence` của
  S3-R09 khi `s3_matcher = fs`.
- Quyết định theo người có điểm cao nhất `W1`, người thứ hai `W2`:

| Điều kiện | Kết quả |
|---|---|
| `W1 ≥ upper` và `W1 − W2 ≥ ambiguity_margin` | `MATCH`: ghép (`matched_by = FS`) |
| `W1 ≥ upper` và `W1 − W2 < ambiguity_margin` | `AMBIGUOUS_IDENTITY_MATCH` (không ghép) |
| `lower < W1 < upper` | `POSSIBLE_MATCH`: không ghép, `unmapped` kèm `candidate_person_id` (FS-R07) |
| `W1 ≤ lower` | `NO_IDENTITY_MATCH` (không ghép) |

- Lặp tới điểm bất động (≤ 5 vòng) như S3-R06; mỗi vòng ghép **theo thứ tự `W1` giảm dần**, cập nhật `K(p)` rồi chấm lại.

### 3.4 Tham số trong catalog

`lib/loan-dossier/catalog/data/fs_params.json` (bản spec ở `03_catalogs/fs_params.json`, giữ đồng bộ như các catalog khác), kiểm bằng zod
khi nạp. Bản đầu dùng tham số chuyên gia (giá trị đã thử ở §1):

```json
{
  "params_version": "0.1.0-expert",
  "source": "EXPERT",
  "estimated_at": null,
  "dataset_ref": null,
  "prior_match_probability": 0.2,
  "thresholds": { "upper": 10, "lower": 0, "ambiguity_margin": 6 },
  "comparisons": {
    "id_number":         { "AGREE": { "m": 0.95, "u": 0.000001 }, "OLD_NEW": { "m": 0.02, "u": 0.01 }, "NEAR": { "m": 0.02, "u": 0.00001 }, "DISAGREE": { "m": 0.01, "u": 0.98899 } },
    "full_name":         { "EXACT": { "m": 0.80, "u": 0.01 }, "REORDERED": { "m": 0.05, "u": 0.001 }, "SPELLING_DIFFERENCE": { "m": 0.12, "u": 0.005 }, "NO_MATCH": { "m": 0.03, "u": 0.984 } },
    "date_of_birth":     { "AGREE": { "m": 0.96, "u": 0.0001 }, "DAY_MONTH_SWAPPED": { "m": 0.01, "u": 0.0001 }, "DISAGREE": { "m": 0.03, "u": 0.9998 } },
    "gender":            { "AGREE": { "m": 0.99, "u": 0.5 }, "DISAGREE": { "m": 0.01, "u": 0.5 } },
    "permanent_address": { "AGREE": { "m": 0.6, "u": 0.3 }, "SAME_PROVINCE": { "m": 0.3, "u": 0.4 }, "DISAGREE": { "m": 0.1, "u": 0.3 } },
    "id_structure":      { "CONSISTENT": { "m": 0.97, "u": 0.3 }, "INCONSISTENT": { "m": 0.03, "u": 0.7 } }
  }
}
```

`u` của tên và địa chỉ cao hơn mức "hai người ngẫu nhiên" vì người khác trong **cùng hồ sơ** thường là người nhà: cùng họ, cùng địa chỉ (FS-R10).

### 3.5 Rule

| ID | Rule |
|---|---|
| **FS-R01** | **Vá ngay, không cần FS** (chế độ `rules`): party có số **và** ngày sinh đều khác **lời khai trên anchor** của người (số khai `declared_id_number`, ngày sinh trên party anchor; cả hai bên khác null; không phải cặp 9 ↔ 12 số) thì **không** ghép theo tên ở S3-R07; ra `unmapped` với `NO_IDENTITY_MATCH`. Chỉ so với anchor, không so với thẻ đã ghép theo tên: hai thẻ cùng tên mà anchor không phân xử được vẫn gộp để S3-R11 báo `role_conflict` (S3-AC06, S4-AC29 giữ nguyên) |
| **FS-R02** | Bộ chấm là hàm thuần, tất định: cùng (evidences, registry, `params_version`) → cùng kết quả, kể cả thứ tự ghép. Không đọc DB, không gọi mạng |
| **FS-R03** | Mức so sánh tính **chỉ** bằng các hàm chuẩn hóa sẵn có (`normIdNumber`, `nameLevel`, chuẩn hóa ngày, địa chỉ), không viết luật tên thứ hai |
| **FS-R04** | Khử phụ thuộc giữa các trường: `id_number` ở `AGREE` hoặc `NEAR` thì bỏ `gender` và `id_structure` (đã mã hóa trong số). `id_structure` chỉ tính khi party mới có số 12 chữ số và người có ngày sinh hoặc giới tính |
| **FS-R05** | Ràng buộc cứng giữ nguyên: cá nhân ≠ pháp nhân; pháp nhân ghép theo S3-R06 hiện tại. FS không bao giờ ghép hai party của **cùng** một evidence vào một người, trừ khi luật tách chủ sở hữu ghép (T-S3-02) đã tách |
| **FS-R06** | `mapped_evidences[]` khi `fs`: `matched_by = FS`, `match_confidence = P`, thêm `match_weight = W` và `match_breakdown = {trường: mức}` (**chỉ mức, không giá trị**). LAC giữ ngưỡng `LOW_MATCH_CONFIDENCE < 0.80` trên `P` |
| **FS-R07** | `POSSIBLE_MATCH` là lý do mới của `unmapped_evidences` (mở rộng S3-R10), kèm `candidate_person_id` và `match_weight`. Không tự ghép (OQ-FS-01). Người duyệt xác nhận theo luồng CO của [loan_360.md](loan_360.md) |
| **FS-R08** | **Chế độ** qua tham số `s3_matcher`: `rules` (mặc định), `shadow`, `fs` (**chưa mở**: đợt D-109 chỉ khai `rules` / `shadow`, `fs` mở ở T-FS-06; giá trị lạ → `rules`). Khai báo trong `lib/endpoints/registry.ts` như `lac_mode`, Profile khóa được. `shadow`: chạy cả hai, output lấy từ `rules`, ghi thống kê khác biệt vào `s3_matcher_summary` của kết quả cuối (S3 ở giai đoạn 2 không lưu step riêng nên không có `content_preview` của S3) |
| **FS-R09** | **Catalog lỗi thì không đoán.** `fs_params.json` không qua zod (thiếu mức, `m`/`u` ∉ (0, 1], `Σm` hoặc `Σu` của một trường lệch 1 quá 0,01, `upper ≤ lower`) → chạy `rules`, warning `FS_PARAMS_INVALID`. Mọi Operation ghi `params_version` đã dùng |
| **FS-R10** | **Ước lượng `u` trong cùng hồ sơ**: cặp không phải cùng người lấy từ party **cùng Operation** (blocking theo `operation_id`), không lấy cặp giữa các hồ sơ, vì người khác trong cùng hồ sơ thường là người nhà nên trùng họ, trùng địa chỉ nhiều hơn hai người ngẫu nhiên |
| **FS-R11** | **Ước lượng dùng chính `comparePair`** của bộ chấm, không viết lại mức so sánh ở công cụ khác: mức lúc ước lượng và lúc chạy luôn trùng nhau |
| **FS-R12** | **Đổi tham số là đổi mô hình.** Mỗi `fs_params.json` mới tăng `params_version`, ghi `source`, `estimated_at`, `dataset_ref` (mã bộ dữ liệu, không phải đường dẫn chứa dữ liệu), kèm báo cáo đánh giá trên bộ hồ sơ chuẩn; người duyệt theo OQ-FS-03 |
| **FS-R13** | **PII.** Không log, không ghi `content_preview` giá trị tên, số, ngày sinh, địa chỉ (S3-R26). Nhãn của bộ hồ sơ chuẩn và báo cáo đánh giá chi tiết **không** commit, chỉ nằm trong môi trường nội bộ (SECURITY-RULES #10). `fs_params.json` chỉ chứa xác suất, commit được |

## 4. Ước lượng tham số từ bộ hồ sơ chuẩn

Không dùng Splink / EM (D-111): bộ hồ sơ chuẩn có nhãn người nên `m`, `u` đếm trực tiếp; công cụ ngoài chỉ cần khi có nhiều dữ liệu mà không
có nhãn. Script TypeScript `scripts/fs-estimate-params.ts`, chạy trong môi trường nội bộ, không cần Python.

1. **Đầu vào**: các Operation UAT đã chạy, cộng file nhãn `{operation_id, party_key, gold_person_id}` (nội bộ, không commit, FS-R13).
2. **Cặp**: mọi cặp (party chưa thuộc anchor, người trong registry) **trong cùng Operation** (FS-R10); nhãn cho biết cặp là cùng người hay không.
3. **Đếm**: mức mỗi trường lấy bằng `comparePair` (FS-R11); `m_ℓ` = tỷ lệ cặp cùng người ở mức `ℓ`, `u_ℓ` = tỷ lệ cặp khác người ở mức `ℓ`,
   cộng thêm 0,5 vào mỗi ô (Laplace) để không có xác suất 0.
4. **Kiểm**: mức có < 30 cặp ở phía nào thì giữ giá trị chuyên gia của phía đó và ghi rõ trong báo cáo. Thứ tự trọng số phải hợp lý
   (`AGREE` > `NEAR` > `DISAGREE`…), sai thứ tự thì không xuất.
5. **Chọn ngưỡng** trên cùng bộ: ràng buộc **tỷ lệ gộp nhầm** ≤ mục tiêu (OQ-FS-02), tối đa tỷ lệ tự ghép; báo cáo precision / recall theo
   cặp và số ca `POSSIBLE_MATCH` (chỉ số đếm).
6. **Xuất** `fs_params.json` đúng schema (`source = "ESTIMATED"`, `dataset_ref` = mã bộ hồ sơ chuẩn), tăng `params_version` (FS-R12).

## 5. Acceptance criteria

| # | Tiêu chí |
|---|---|
| FS-AC01 | `s3_matcher = rules` (mặc định): output S3 **giống hệt** hiện tại trên mọi fixture, trừ ca FS-R01 |
| FS-AC02 | Chế độ `rules`: cùng tên, khác số, khác ngày sinh → không ghép, `unmapped` `NO_IDENTITY_MATCH` (ca 1 của §1, FS-R01) |
| FS-AC03 | `shadow`: output S3 giống `rules`; `s3_matcher_summary` có `params_version` và số đếm theo loại khác biệt, không có tên / số / ngày sinh |
| FS-AC04 | `fs`, tham số chuyên gia: 5 ca §1 cho đúng cột FS (ca 1 không ghép, ca 2 ghép, ca 3 ghép, ca 4 `POSSIBLE_MATCH` kèm `candidate_person_id`, ca 5 ghép) |
| FS-AC05 | `fs`: hai người cùng tên, cùng ngày sinh, party mới không có số → `AMBIGUOUS_IDENTITY_MATCH` |
| FS-AC06 | `fs`: số 12 chữ số của party mới mã hóa giới tính / năm sinh trái với người → `id_structure = INCONSISTENT`, điểm giảm so với cùng ca có `CONSISTENT` |
| FS-AC07 | `fs_params.json` hỏng (theo FS-R09) → chạy `rules`, warning `FS_PARAMS_INVALID` |
| FS-AC08 | Cùng input, cùng `params_version` chạy 2 lần → output giống hệt (FS-R02) |
| FS-AC09 | Script ước lượng trên bộ nhãn giả: mức đủ 30 cặp lấy giá trị đếm, mức thiếu giữ giá trị chuyên gia; file xuất qua schema (FS-R09, FS-R11) |
| FS-AC10 | `match_breakdown` chỉ chứa tên trường và mức; quét theo giá trị fixture không thấy tên / số / ngày sinh trong log, `content_preview`, `match_breakdown` |

## 6. Task cards

### T-FS-01 — Vá S3: không ghép theo tên khi số và ngày sinh cùng khác
- Depends: T-S3-04
- Files: `lib/loan-dossier/s3/match-parties.ts`, `tests/loan-dossier/s3-match-parties.test.ts`
- Refs: S3-R07, S3-R10
- Làm: FS-R01 trong vòng dự phòng theo tên của `matchParties`; cập nhật S3-R07 trong spec S3.
- DoD:
  - test: FS-AC02
  - test: cặp 9 ↔ 12 số, cùng tên, cùng ngày sinh → vẫn ghép như cũ
  - test: khác số, ngày sinh null một bên → giữ hành vi cũ
  - các test S3 hiện có vẫn qua
- Verify: `npx jest tests/loan-dossier/s3-match-parties.test.ts`

### T-FS-02 — Bộ so sánh và catalog tham số
- Depends: T-COM-01, T-COM-02
- Files: `lib/loan-dossier/s3/fs/compare.ts`, `lib/loan-dossier/s3/fs/params.ts`, `lib/loan-dossier/catalog/data/fs_params.json`, `docs/loan-appraisal/spec-v3/03_catalogs/fs_params.json`, `tests/loan-dossier/s3-fs-compare.test.ts`, `tests/loan-dossier/fixtures/fs-vectors.json`
- Refs: S3-R06, S3-R07, S3-R26
- Làm: FS-R02…R04, FS-R09; `comparePair(party, person) → {trường: mức}`; schema zod của `fs_params.json`.
- DoD:
  - test: mỗi mức của §3.2 có ít nhất một ca
  - test: FS-AC06, FS-AC07
  - test: confidence parties < 0.50 → `id_number = MISSING`
  - test: vector chuẩn qua toàn bộ
- Verify: `npx jest tests/loan-dossier/s3-fs-compare.test.ts`

### T-FS-03 — Bộ chấm, quyết định và chế độ `s3_matcher`
- Depends: T-FS-02
- Files: `lib/loan-dossier/s3/fs/score.ts`, `lib/loan-dossier/s3/match-parties.ts`, `lib/loan-dossier/s3/run.ts`, `lib/endpoints/registry.ts`, `lib/pipelines/workflows/loan-appraisal.ts`, `tests/loan-dossier/s3-fs-score.test.ts`
- Refs: S3-R06, S3-R09, S3-R10, S3-R26
- Làm: §3.3, FS-R05…R08; `shadow` ghi `content_preview.fs`; `fs` đổi `mapped_evidences` và thêm lý do `POSSIBLE_MATCH`. Đọc `docs/SECURITY-RULES.md` trước khi sửa `registry.ts`.
- DoD:
  - test: FS-AC01, FS-AC03, FS-AC04, FS-AC05, FS-AC08
  - test: ghép theo thứ tự `W1` giảm dần, lặp ≤ 5 vòng
  - test: FS-AC10
- Verify: `npx jest tests/loan-dossier/s3-fs-score.test.ts tests/loan-dossier/s3-match-parties.test.ts`

### T-FS-04 — Báo cáo shadow
- Depends: T-FS-03
- Files: `scripts/fs-shadow-report.ts`, `tests/scripts/fs-shadow-report.test.ts`
- Refs: S3-R26
- Làm: như `scripts/lac-shadow-report.ts`: đọc `content_preview.fs` của các Operation, xuất Markdown / CSV chỉ có id và số đếm; fetch qua `ssrfSafeFetch` + timeout.
- DoD:
  - test: báo cáo không chứa giá trị nào của fixture
  - test: gộp số đếm đúng trên 3 Operation giả
- Verify: `npx jest tests/scripts/fs-shadow-report.test.ts`

### T-FS-06 — Đánh giá và bật `fs`
- Depends: T-FS-04
- Files: `scripts/fs-estimate-params.ts`, `tests/scripts/fs-estimate-params.test.ts`, `lib/loan-dossier/catalog/data/fs_params.json`, `docs/loan-appraisal/spec-v3/03_catalogs/fs_params.json`, báo cáo đánh giá trong `docs/loan-appraisal/uat-analysis/` (chỉ số đếm)
- Refs: S3-R06, S3-R09
- Làm: §4 (script đếm m/u + FS-AC09), ước lượng trên UAT, chọn ngưỡng (§4 bước 5), so shadow với nhãn của bộ hồ sơ chuẩn; ghi quyết định bật hay chưa vào IMPLEMENT.
- DoD:
  - test: FS-AC09
  - tỷ lệ gộp nhầm trên bộ hồ sơ chuẩn ≤ mục tiêu của OQ-FS-02
  - báo cáo có precision / recall theo cặp, số ca `POSSIBLE_MATCH`, so với `rules`
  - `params_version` mới được duyệt theo OQ-FS-03
- Verify: `npx jest tests/scripts/fs-estimate-params.test.ts tests/loan-dossier/s3-fs-compare.test.ts tests/loan-dossier/s3-fs-score.test.ts`

## 7. Điều chưa kiểm chứng

- Tham số §3.4 là giá trị chuyên gia; 5 ca ở §1 chỉ cho thấy cách làm khả thi, chưa chứng minh độ chính xác.
- Chưa biết bộ hồ sơ chuẩn có đủ cặp cho từng mức (cần ≥ 30 cặp mỗi mức, §4 bước 4); mức hiếm (`NEAR`, `DAY_MONTH_SWAPPED`) gần như chắc thiếu; thiếu thì giữ giá trị chuyên gia.
- Chưa có bộ hồ sơ chuẩn có nhãn người (đề xuất ở lượt review LAC); T-FS-06 phụ thuộc vào nó.
- Mức `NEAR` chỉ đếm khác 1 ký tự; chưa dùng bảng ký tự OCR hay nhầm (0/O, 1/l, 5/S, 8/B).
- Ba nơi đọc `match_confidence` (LAC `build.ts`, `graph/render.ts`, `graph/view.ts`) dùng ngưỡng 0.80; `P` của FS phân bố khác cách chặn
  0.90 / 0.85 của S3-R09, nên tỷ lệ cờ `LOW_MATCH_CONFIDENCE` sẽ đổi khi bật `fs`.

## 8. Điểm cần quyết

| ID | Câu hỏi | Mặc định đề xuất | Ai quyết |
|---|---|---|---|
| **OQ-FS-01** | `POSSIBLE_MATCH` để `unmapped` chờ người xác nhận, hay ghép kèm cờ `LOW_MATCH_CONFIDENCE` | **Đã quyết (D-112):** Để `unmapped` (gộp nhầm khó sửa hơn thiếu ghép) | BA + Risk |
| **OQ-FS-02** | Mục tiêu tỷ lệ gộp nhầm khi chọn ngưỡng | **Đã quyết (D-112):** 0 trên bộ hồ sơ chuẩn | Risk |
| **OQ-FS-03** | Ai duyệt một `params_version` mới; có áp quy trình quản lý rủi ro mô hình của ngân hàng không | **Đã quyết (D-112):** Dev lead + Risk, có báo cáo đánh giá đi kèm | Risk |
| **OQ-FS-04** | Bảng ánh xạ địa danh trước / sau sáp nhập đơn vị hành chính 2025 (trùng câu hỏi Q5 của uat-analysis) | **Đã quyết (D-112):** Chưa có thì `permanent_address` chỉ có `AGREE` / `MISSING` | Đơn vị |
| **OQ-FS-05** | Dùng bảng tần suất tên riêng tiếng Việt để chỉnh `u` theo độ phổ biến của tên không; nguồn bảng | **Đã quyết (D-112):** Không ở v1 | BA |
