# Plan: Bộ chấm Fellegi-Sunter cho S3, chạy shadow (T-FS-02, T-FS-03 phần shadow, T-FS-04)

Spec: `docs/loan-appraisal/spec-v3/cross_cutting/s3_fellegi_sunter.md` (D-109). Đọc §3 và §3.5 trước khi viết code.
Nhánh: `codex/fs-scorer`, tách từ `chore/phase0-foundation` (đã có T-FS-01 trong `lib/loan-dossier/s3/match-parties.ts`).
KHÔNG commit thay người dùng ngoài nhánh này; KHÔNG sửa file ngoài danh sách Files của từng bước. Chạy test: `npx jest <path> --ci`.
Typecheck: `npx tsc --noEmit`. Comment tiếng Việt, theo phong cách file xung quanh (ngắn, nêu rule ID).

## Phạm vi đợt này (khác spec, có chủ đích)

- **Chỉ `rules` và `shadow`.** Chế độ `fs` (đổi output S3, lý do `POSSIBLE_MATCH`, `match_weight` trong `mapped_evidences`) để sau
  T-FS-06, khi tham số đã hiệu chỉnh. Không đổi `UnmappedEvidenceSchema`, không đổi `MapDossierData`.
- **Test tối thiểu** (yêu cầu của người dùng): mỗi bước chỉ các test liệt kê dưới đây. Không thêm property test, không snapshot.

## Sự thật từ code (đã đọc)

- `matchParties(persons, evidences, anchorId)` (`lib/loan-dossier/s3/match-parties.ts`) sửa `persons` tại chỗ; `otherParties()` cho
  danh sách party cần ghép; `Person` ở `lib/loan-dossier/s3/types.ts` có `parties[]` (PartyRef: `evidence_id`, `party`, `confidence`),
  `known_ids`, `declared_id_number`, `full_name`, `party_type`.
- Hàm sẵn có, phải dùng lại (FS-R03): `normIdNumber` (`common/normalize`), `nameLevel` (`common/name`), `isOldNewPair`, `sameId`
  (`common/id-number`). `DocumentParty.gender` theo enum catalog (`MALE` / `FEMALE` …); `permanent_address` có `full_text`, `province`.
- S3 ở giai đoạn 2 chạy qua `runMapStage(evidences, pipelineVars)` (`lib/pipelines/workflows/loan-appraisal/dossier-map.ts`), **không** lưu
  step riêng, nên thống kê shadow phải đi vào kết quả cuối (như `loan_application_context_summary` trong `loan-appraisal.ts`).
- Mẫu khai tham số chạy: `lac_mode` trong `lib/endpoints/registry.ts` (`options`, `default`) + `resolveLacMode` trong
  `lib/pipelines/workflows/loan-appraisal/prompt-checks.ts` + test `tests/loan-appraisal/lac-mode-param.test.ts`.
- Đọc `docs/SECURITY-RULES.md` trước khi sửa `lib/endpoints/registry.ts`.

## Bước

- [ ] 1. **Bộ so sánh + catalog tham số (T-FS-02).**
      - `lib/loan-dossier/s3/fs/params.ts`: schema zod cho `fs_params.json` đúng §3.4; `loadFsParams()` đọc
        `lib/loan-dossier/catalog/data/fs_params.json` (cách nạp JSON giống `lib/loan-dossier/s4/catalog.ts`); hỏng theo FS-R09 → trả
        `{ ok: false, reason }`, không throw.
      - `lib/loan-dossier/catalog/data/fs_params.json` và bản sao `docs/loan-appraisal/spec-v3/03_catalogs/fs_params.json`: đúng JSON ở §3.4.
      - `lib/loan-dossier/s3/fs/compare.ts`: `comparePair(party: DocumentParty, ref: PartyRef, person: Person) → Record<Field, Level>`
        theo bảng §3.2 và FS-R04 (bỏ `gender`, `id_structure` khi `id_number` ∈ {AGREE, NEAR}). `id_number` so với cả `K(p)`;
        confidence < 0.50 → `MISSING`. `id_structure`: chữ số thứ 4 của số 12 chữ số (0/1 = nam/nữ thế kỷ 20, 2/3 = nam/nữ thế kỷ 21),
        chữ số 5–6 = hai số cuối năm sinh; so với ngày sinh / giới tính của `ref.party`.
      - Test `tests/loan-dossier/s3-fs-compare.test.ts`: (a) một `it.each` mỗi mức của §3.2 một dòng; (b) params hỏng (`upper ≤ lower`) → `ok: false`.
      Verify: `npx jest tests/loan-dossier/s3-fs-compare.test.ts --ci`

- [ ] 2. **Bộ chấm (T-FS-03, phần lõi).** `lib/loan-dossier/s3/fs/score.ts`:
      - `pairWeight(levels, params) → { W, breakdown }`; `MISSING` = 0; `W = Σ log2(m/u)`.
      - `matchPartiesFs(persons, evidences, anchorId, params) → { personOf, decisions }`: cùng khung với `matchParties` (chỉ party
        `INDIVIDUAL`; pháp nhân giữ nguyên luật mã số thuế của `matchParties`, gọi lại logic cũ hoặc bỏ qua pháp nhân), điểm party ↔ người
        = max trên `person.parties`; quyết định §3.3 (`MATCH` / `AMBIGUOUS_IDENTITY_MATCH` / `POSSIBLE_MATCH` / `NO_IDENTITY_MATCH`);
        mỗi vòng ghép theo `W1` giảm dần, ≤ 5 vòng, cập nhật `known_ids`. Hàm thuần, không đổi `persons` đầu vào (clone).
      - Test `tests/loan-dossier/s3-fs-score.test.ts`: (a) một `it.each` 5 ca ở bảng §1 của spec → đúng cột FS (chỉ kiểm quyết định);
        (b) hai người cùng tên, cùng ngày sinh, party không số → `AMBIGUOUS_IDENTITY_MATCH`.
      Verify: `npx jest tests/loan-dossier/s3-fs-score.test.ts --ci`

- [ ] 3. **Chế độ shadow (T-FS-03, phần nối).**
      - `lib/endpoints/registry.ts`: tham số `s3_matcher` (`options: ['rules', 'shadow']`, `default: 'rules'`), mô tả ngắn như `lac_mode`.
      - `dossier-map.ts`: `runMapStage` đọc `pipelineVars.s3_matcher`; `shadow` → sau `runMapDossier`, dựng lại registry từ anchor
        (`pickAnchor` + `buildRegistry`, độc lập với kết quả luật) và chạy `matchPartiesFs`; so `personOf` của hai bên theo party key; trả
        thêm `fs_shadow: { params_version, same, rules_only, fs_only, different_person, fs_possible, fs_ambiguous }` (chỉ số đếm, FS-R13).
        Params hỏng → không có `fs_shadow`, warning `FS_PARAMS_INVALID`. `data` của S3 **luôn** là kết quả luật.
      - `lib/pipelines/workflows/loan-appraisal.ts` + `lib/pipelines/workflows/loan-appraisal/types.ts`: kết quả cuối thêm
        `s3_matcher_summary` (vắng khi `rules`), đặt cạnh `loan_application_context_summary`.
      - Test: thêm 1 case vào `tests/loan-appraisal/lac-mode-param.test.ts` (hoặc file mới cùng mẫu) rằng `s3_matcher` là tham số khai báo;
        `tests/loan-dossier/s3-fs-shadow.test.ts`: `runMapStage(..., { s3_matcher: 'shadow' })` cho `data` giống hệt `rules` và
        `fs_shadow` không chứa tên / số / ngày sinh của fixture (quét `JSON.stringify`).
      Verify: `npx jest tests/loan-dossier/s3-fs-shadow.test.ts tests/loan-appraisal/lac-mode-param.test.ts --ci`

- [ ] 4. **Báo cáo shadow (T-FS-04).** `scripts/fs-shadow-report.ts` theo mẫu `scripts/lac-shadow-report.ts` (cùng cách đọc Operation, fetch
      qua `ssrfSafeFetch` + `AbortSignal.timeout`, `--allow-localhost`); đọc `s3_matcher_summary`, xuất Markdown / CSV chỉ số đếm.
      Test `tests/scripts/fs-shadow-report.test.ts`: gộp 2 Operation giả → tổng đúng (theo mẫu `tests/scripts/lac-compare.test.ts`).
      Verify: `npx jest tests/scripts/fs-shadow-report.test.ts --ci`

- [ ] 5. **Kiểm toàn bộ.** `npx tsc --noEmit`; `npx jest tests/loan-dossier tests/loan-appraisal tests/scripts --ci` (mốc hiện tại: loan-dossier
      79 suite / 1004 test đều qua). Cập nhật spec: §3.5 FS-R08 ghi rõ `fs` chưa mở; IMPLEMENT.md thêm một dòng dưới D-109 (đã làm gì,
      lệch spec gì). Ghi kết quả từng Verify vào `.agents/tasks/fs-scorer/verification.md`.

## Không làm

- Chế độ `fs`, thay đổi `mapped_evidences` / `unmapped_evidences`, LAC, S4.
- Bảng tần suất tên, bảng ánh xạ địa danh 2025 (`permanent_address` chỉ `AGREE` / `SAME_PROVINCE` / `DISAGREE` / `MISSING` trên dữ liệu thô).
