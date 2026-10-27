# PLAN — Viết lại Specs Loan Appraisal (spec-v3)

> Quy tắc: chỉ đánh `[x]` khi đã chạy lệnh **Verify** của milestone và pass.
> Nhật ký quyết định / lệch kế hoạch: xem [IMPLEMENT.md](IMPLEMENT.md) (append-only).

## Mục tiêu

Một bộ spec **mới, tự đủ** để dev agent code trực tiếp, người review đọc nhanh.
Không giữ tương thích ngược với v1/v2.

## Nguồn

| Nguồn | Dùng để |
|---|---|
| `D:/WorkingFolder/Specs_Sprint_1-2_v2` | Rule nghiệp vụ, catalog (đã kiểm tra: nhiều phần đúng, nhưng thiếu stage 6 + 17 schema) |
| `D:/WorkingFolder/Specs_Sprint_1-2_20261012` | Stage 6 `compare_ocr_sl` (v2 không có) |
| UI BU `xac-nhan-thong-tin-khach-hang-full 2.html` | Nhu cầu rà soát OCR, form xác nhận |
| UI `/loan-appraisal-v2` trong repo | Bố cục, bộ thành phần, cách chạy và poll của giao diện (D-27) |
| Repo `dugate` | Route workflow, worker, registry, tests |

## In-scope

- Hai workflow không lưu trạng thái: W1 `loan-dossier-ocr` (S1–S2), W2 `loan-dossier-check` (S3–S6) (D-25).
- 6 stage: `classify`, `extract_evidence`, `map_dossier_roles`, `check_checklist`, `cross_check_documents`, `compare_ocr_sl`.
- Rà soát/sửa OCR và form xác nhận KH ở client; ngưỡng tự động.
- Giao diện `/loan-dossier` theo `/loan-appraisal-v2`.

## Out-of-scope

- Lưu hồ sơ, nháp, lịch sử, quyết định CO ở DUGate (D-25).
- Stage thẩm định tài chính/rủi ro (CFADS, DSCR, 5C, policy, score, khuyến nghị).
- `compare_ocr_il` (chưa có spec nguồn).
- Xóa module `loan-appraisal` / `loan-appraisal-v2` hiện có, hoặc sửa workflow `loan-appraisal` (D-09). Thành phần UI của v2 chỉ được **nâng cấp tương thích ngược** để dùng lại (D-29, U1-R15).

## Milestones (spec)

- [x] **M1** Catalog sạch sinh từ v2, kiểm tra tham chiếu chéo pass.
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only catalogs` (từ D-37 `03_catalogs/` là nguồn chuẩn, sửa trực tiếp; `build_catalogs.py` đã gỡ)
- [x] **M2** Tài liệu nền: README, overview, conventions, data model.
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only links`
- [x] **M3** 6 spec stage (rule có ID, AC, task card).
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only stages`
- [x] **M4** 4 spec UI + persistence/RBAC/security.
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only ui`
- [x] **M5** Backlog tổng (thứ tự task, phụ thuộc không vòng) + open questions.
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only backlog`
- [x] **M6** Toàn bộ kiểm tra pass (link không hỏng, ID duy nhất, mọi task có Verify, không còn key legacy, không có PII mẫu thật).
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py`
- [x] **M7** Viết lại theo kiến trúc không lưu trạng thái + giao diện theo `/loan-appraisal-v2` (D-25…D-27). `build_backlog.py` + `check_spec.py` PASS (V-12); `build_catalogs.py` chạy lại ngày 2026-10-16, sinh ra đúng bản catalog đang có (không diff).
  Verify: `python docs/loan-appraisal/spec-v3/tools/build_backlog.py && python docs/loan-appraisal/spec-v3/tools/check_spec.py`

## Quy ước task card (áp cho mọi file spec)

Mỗi task: **≤ 1 module + 1 file test**, ≤ ~150 dòng code dự kiến, có `Depends`, `Files`, `Refs` (rule ID), `DoD` (test cụ thể), `Verify` (lệnh chạy được).

---

# Phần B — Code trên nền v2 (chưa bắt đầu; IMPLEMENT D-32)
> Hướng: engine S1–S5 là hàm thuần ở `lib/loan-dossier/` (task card của stage), workflow v2 `loan-appraisal` 8 stage gọi chúng (`cross_cutting/v2_integration.md`). Phần W1/W2, `/loan-dossier`, S6 không làm (D-32). Kế hoạch C1–C6 theo W1/W2 trước đây bỏ.
> Lệnh chung: `npx tsc --noEmit -p tsconfig.json`, `npx jest tests/loan-dossier`, `npx jest tests/loan-appraisal`, `npx jest tests/loan-appraisal-v2`.

- [x] **C1** Nền: đồng bộ và nạp catalog, hợp đồng `data` S1–S5, chuẩn hóa, schema chung, hiệu lực. (2026-10-16, nhánh `feat/loan-dossier-c1`; T-CON-02 chỉ S3–S5, phần S6 bỏ theo D-32)
  Tasks: T-CAT-01, T-CAT-02, T-CON-01, T-CON-02, T-S2-02, T-S2-03, T-S4-02, T-COM-01, T-COM-02, T-TEST-01.
  Verify: `npx jest tests/loan-dossier/catalog- tests/loan-dossier/contract- tests/loan-dossier/common- tests/loan-dossier/s2-common-schema.test.ts && npx tsc --noEmit -p tsconfig.json`
- [x] **C2** Zod cho 27 loại `FULL` (T-DOC-01…27) dịch đúng JSON Schema — JSON Schema của cả 27 loại đã có (D-33) — và bóc tách nhẹ (T-S2-10). (2026-10-16, nhánh `feat/loan-dossier-c1`; zod sinh bởi `npm run gen:loan-doc-schemas` vào `lib/loan-dossier/s2/schemas/`, test so với Ajv 2020-12 trên fixture + đột biến từng nút; kèm registry T-S2-01)
  Verify: `npx jest tests/loan-dossier/s2-schema- tests/loan-dossier/s2-light.test.ts`
- [x] **C3** Engine S1, S2 và stage 0–1 của v2 (T-V2-01, T-V2-02). (2026-10-19, nhánh `feat/loan-dossier-c1`; gồm T-S1-01…07, T-S2-04…09 và T-S3-07 `asset-key` — `assetKeyFn` của khóa trùng. Port thật ở `lib/pipelines/workflows/loan-appraisal/stage-adapters.ts`: gửi bản sao tên trung tính `{file_id}-p{a}-{b}`, cắt trang bằng pdf-lib. Stage 2–7 đọc S1/S2 qua cầu nối tạm `dossier-stages.ts` tới T-V2-03/T-V2-08. Chưa chạy với model/storage thật)
  Verify: `npx jest tests/loan-dossier/s1- tests/loan-dossier/s2- tests/loan-appraisal/v2-stage-classify.test.ts tests/loan-appraisal/v2-stage-extract.test.ts`
- [x] **C4** Engine S3, S4, S5 và stage 2 (T-V2-03), registry evidence, Customer 360 (T-V2-04, T-V2-05). (2026-10-19, nhánh `feat/loan-dossier-c1`; engine ở `lib/loan-dossier/s3|s4|s5/`, stage 2 ở `lib/pipelines/workflows/loan-appraisal/dossier-consolidate.ts`, registry + provenance ở `evidence-v3.ts`. Stage 3–7 đọc S3–S5 qua cầu nối tạm `toLegacyEvaluation`/`toLegacyIntake` tới T-V2-06…08; `grouping.ts` và module cũ gỡ ở T-V2-11. Lệch nhỏ ghi ở IMPLEMENT V-18)
  Verify: `npx jest tests/loan-dossier/s3- tests/loan-dossier/s4- tests/loan-dossier/s5- tests/loan-appraisal/v2-stage-consolidate.test.ts tests/loan-appraisal/v2-evidence-registry.test.ts tests/loan-appraisal/v2-master-data.test.ts`
- [x] **C5** Stage 3–7, rule, output, giao diện, gỡ phần cũ (T-V2-06…09, T-V2-11). (2026-10-19, nhánh `feat/loan-dossier-c1`; output 3.0 + payload tích hợp 2.0; trang `/loan-appraisal` cũ gỡ theo D-34; giao diện `/loan-appraisal-v2` đọc S1–S5 qua `app/loan-appraisal-v2/lib/dossier-view.ts`; lệch ghi ở IMPLEMENT V-19)
  Verify: `npx jest tests/loan-appraisal tests/loan-appraisal-v2 && npx tsc --noEmit -p tsconfig.json`
- [ ] **C6** UAT và cổng cuối: T-V2-10 (chấm 4 hồ sơ UAT), T-SEC-05, T-TEST-02, T-TEST-04.
  Verify: `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 && npm run build`

---

# Phần C — Hiệu chỉnh `master_dossier` bằng LLM (D-67)
> Mục tiêu: sau khi dựng master (MD-R01) ở giai đoạn 1, chạy thêm **một** lần LLM để hiệu chỉnh trường xung đột khi đủ căn cứ; giá trị hiệu chỉnh được mọi bước sau dùng. Spec: `cross_cutting/master_dossier.md` MD-R15…MD-R20, T-MD-09…12. Quyết định: IMPLEMENT D-67, D-68, D-69. Câu hỏi mở: OQ-30…OQ-33 (OQ-34 đã đóng).
> Lệnh chung: `npx tsc --noEmit -p tsconfig.json`, `npx jest tests/loan-dossier`, `npx jest tests/loan-appraisal`, `npx jest tests/loan-appraisal-v2`. **Baseline trước khi làm (2026-10-20):** `tsc` đã có 3 lỗi và 2 suite `tests/loan-appraisal` đã lỗi (`v2-output`, `v2-no-legacy`), do sửa đổi chưa commit của tiến trình khác ở `integration-payload.ts`. Cổng của phần C: không thêm lỗi mới so với baseline.

**In-scope:** trạng thái `CORRECTED`; guard tất định; một lời gọi LLM `master_correction` (LLM chọn một trong các giá trị đã đọc, chỉ trả `option_id`; kiểm tra V1, V2 sau LLM, D-69); cache ở checkpoint bước 2; dùng giá trị hiệu chỉnh ở registry Rule LLM, đầu vào tài chính, Customer 360 của Rule LLM, tiêu chí 2; nhãn giao diện.
**Out-of-scope:** đọc lại ảnh gốc (`IMAGE_RECHECK`); sửa `money`/`number`/`address`/`text`/`enum`/`boolean`; tính lại S4/S5 sau hiệu chỉnh (dòng S5 và checklist giữ nguyên làm bằng chứng sai lệch gốc); sửa `integration-payload.ts` (đang có sửa đổi dở của tiến trình khác — `briefField` đã chuyển `status` và `note` nên đủ).

- [x] **C7** Hợp đồng `CORRECTED` + guard và áp dụng hiệu chỉnh thuần (T-MD-09, T-MD-10). (2026-10-20; `lib/loan-dossier/master/correct.ts`, 52 test pass, `tsc` không thêm lỗi so với baseline)
  Verify: `npx jest tests/loan-dossier/md-correct.test.ts tests/loan-dossier/md-document.test.ts tests/loan-dossier/md-entity.test.ts tests/loan-dossier/catalog-`
- [x] **C8** Bước LLM, cache checkpoint, nối vào workflow (T-MD-11). (2026-10-20; `master-correction.ts`, 46 test pass, `tsc` không thêm lỗi so với baseline)
  Verify: `npx jest tests/loan-appraisal/v2-master-correction.test.ts tests/loan-appraisal/v2-intake-review.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts`
- [x] **C9** Giá trị hiệu chỉnh dùng ở các bước sau + giao diện (T-MD-12). (2026-10-20; 36 test pass)
  Verify: `npx jest tests/loan-appraisal/v2-master-correction-downstream.test.ts tests/loan-appraisal/v2-master-dossier.test.ts tests/loan-appraisal/v2-intake-assessment.test.ts tests/loan-appraisal-v2/master-view.test.ts`
- [x] **C10** Cổng cuối: spec check, hồi quy, `tsc` không thêm lỗi so với baseline. (2026-10-20; spec PASS, jest 97/97 suite · 1018/1018 test, `tsc` 0 lỗi)
  Verify: `python docs/loan-appraisal/spec-v3/tools/build_backlog.py && python docs/loan-appraisal/spec-v3/tools/check_spec.py && npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 && npx tsc --noEmit -p tsconfig.json`

---

# Phần D — S1 phân loại kèm tóm tắt và `key_facts` (D-70)
> Mục tiêu: mỗi instance chứng từ có `summary` + `key_facts` theo danh mục cố định để bước đánh giá bằng LLM (chưa làm, OQ-37) dùng thay cho bóc tách đầy đủ ở giai đoạn 1.
> Lệnh chung: `npx tsc --noEmit -p tsconfig.json`, `npx jest tests/loan-dossier`, `npx jest tests/loan-appraisal`, `python docs/loan-appraisal/spec-v3/tools/check_spec.py`. **Baseline (2026-10-21):** `tsc` 0 lỗi.

**In-scope:** `summary_fields` trong `doc_types.json` (27 loại FULL, ≤ 5 key, `loan_application` 7); kiểm tra trong `check_spec.py`; zod loader; sửa spec S1 (R03 giữ, R07 sửa, rule tóm tắt mới); prompt + schema phản hồi + ghép batch + contract `ClassifyInstance`.
**Out-of-scope:** bước LLM đánh giá checklist/liên kết; bỏ S2–S5 ở giai đoạn 1; đổi `stop_after_intake`; 20 loại LIGHT; đo độ chính xác trên UAT.

- [x] **D1** Catalog `summary_fields` + kiểm tra spec + loader. (2026-10-21; `check_spec --only catalogs` PASS và đã thử âm tính 5 kiểu lỗi; sync 37 file; jest catalog- 2 suite · 10 test pass; `tsc` 0 lỗi)
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py --only catalogs && npm run sync:loan-catalogs && npx jest tests/loan-dossier/catalog-`
- [x] **D2** Spec S1 (R07, R19–R23, AC16–AC19, T-S1-08) + prompt + schema + ghép batch + contract. (2026-10-21; `check_spec` PASS, BACKLOG 172 task; jest s1- + contract-stage-result 10 suite · 94 test pass; thử đột biến 5/5 bị bắt)
  Verify: `python docs/loan-appraisal/spec-v3/tools/check_spec.py && npx jest tests/loan-dossier/s1- tests/loan-dossier/contract-stage-result.test.ts`
- [x] **D3** Cổng cuối: hồi quy + `tsc` không thêm lỗi so với baseline. (2026-10-21; jest `tests/loan-dossier` + `tests/loan-appraisal` + `tests/loan-appraisal-v2`: 98 suite · 1034 test pass; `tsc` 0 lỗi)
  Verify: `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 && npx tsc --noEmit -p tsconfig.json`

---

# Phần E — Giai đoạn 1: checklist + liên kết hồ sơ bằng LLM ngay sau classify (D-73, D-74 = PA-2)
> Mục tiêu: sau S1 (kèm `summary`, `key_facts` của D-70), một lời gọi LLM đọc checklist đã resolve + các file/`summary`/`key_facts` và trả ngay (a) checklist theo danh mục hồ sơ, (b) đánh giá sơ bộ quan hệ giữa các chứng từ. Code KHÔNG so sánh nội dung/giá trị giữa chứng từ.
> Lệnh chung: `npx tsc --noEmit -p tsconfig.json`; `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 --testPathIgnorePatterns /node_modules/ /.worktrees/`; `python docs/loan-appraisal/spec-v3/tools/check_spec.py`; `npm run build`. **Baseline (V-34):** tsc 0 lỗi, jest 98 suite · 1034 test pass, build mã 0.

**Đã chốt (D-74, PA-2):** giữ nguyên S2–S5, `intake_assessment`, điểm dừng (`pauseWorkflow` bước 3), `currentStep` và chỉ số stage UI. Bước mới là phần THÊM, chạy trong stage 0 sau `runClassifyStage`.

**Thiết kế:**
- Mô-đun mới `lib/pipelines/workflows/loan-appraisal/dossier-precheck.ts` (hàm thuần + 1 cổng `AskModel`), step key `dossier_precheck`, processor `ext-fact-verifier`, model/reasoning mặc định theo `evaluate` (giống `intake_review`).
- Kết quả lưu vào checkpoint bước 0 (`ClassifyCheckpoint.precheck`) nên resume không gọi lại. Workflow ghi tiến độ ngay sau S1 (UI thấy phân loại) rồi sau precheck (UI thấy checklist).
- Đầu vào LLM: checklist đã resolve (`programForProduct` + `resolveChecklist` với flow và `loan_checklist_overrides`; dòng REQUIRED/CONDITIONAL, chứng từ chấp nhận, thay thế, mô tả điều kiện) + `files[]` của S1. Bọc `untrusted_*`. Không dùng OCR S2.
- Đầu ra: dòng checklist (`PROVIDED|MISSING|UNCERTAIN|NOT_APPLICABLE`, chủ thể, căn cứ file/instance), thực thể (người/tài sản), liên kết (`CONSISTENT|INCONSISTENT|UNCLEAR`), tổng quan, việc cần làm.
- Rào chắn HÌNH THỨC bằng code (không so giá trị): item lạ bị bỏ; mục REQUIRED không có dòng → `UNCERTAIN`; `PROVIDED` thiếu căn cứ hợp lệ hoặc căn cứ không thuộc loại chứng từ chấp nhận → hạ `UNCERTAIN`; ref không tồn tại bị bỏ. Lỗi LLM → `UNAVAILABLE`, không bao giờ báo "đủ hồ sơ".
- Tham số `dossier_precheck` (mặc định bật; `false`/`"false"`/`"0"`/`"no"` tắt).

**Out-of-scope:** bỏ/đổi S2–S5 hay `intake_assessment`; entry Profile UI cho prompt `dossier_precheck` (override vẫn đọc được qua API); đo độ chính xác trên UAT D-38…D-64; giai đoạn 2.
**Rủi ro:** LLM thuần dựa trên `summary`/`key_facts` rút gọn có thể bỏ sót hoặc đánh giá quá lạc quan; kích thước prompt (46 mục × nhiều chứng từ); chưa gọi model thật nên chất lượng chưa biết.

- [x] **E1** Spec (`cross_cutting/v2_integration.md`: V2-R16…R20, T-V2-12…14) + BACKLOG. (đã verify: `build_backlog.py` 175 task + `check_spec.py` PASS, 2026-10-21)
  Verify: `python docs/loan-appraisal/spec-v3/tools/build_backlog.py && python docs/loan-appraisal/spec-v3/tools/check_spec.py`
- [x] **E2** Mô-đun `dossier-precheck.ts`: dựng đầu vào, prompt, schema, rào chắn, tổng hợp theo nhóm + test. (đã verify: jest 20/20 + `tsc` 0 lỗi, 2026-10-21)
  Verify: `npx jest tests/loan-appraisal-v2/dossier-precheck.test.ts`
- [x] **E3** Nối workflow stage 0 + checkpoint + payload + tham số + test. (đã verify: `dossier-precheck-workflow` + `fresh-run` + `stop-after-intake` pass, `tsc` 0 lỗi, 2026-10-21)
  Verify: `npx jest tests/loan-appraisal-v2/dossier-precheck-workflow.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts`
- [x] **E4** UI giai đoạn 1: kiểu, reducer, thẻ "Kiểm tra sơ bộ" + test. (đã verify: `npx jest tests/loan-appraisal-v2` 14 suite · 120 test pass, `tsc` 0 lỗi, 2026-10-21)
  Verify: `npx jest tests/loan-appraisal-v2`
- [x] **E5** Cổng cuối: hồi quy + `tsc` + `check_spec` + `npm run build`. (đã verify 2026-10-21: jest loan-dossier + loan-appraisal + loan-appraisal-v2 + loan-appraisal-cancel = 103 suite · 1079 test pass; `tsc` 0 lỗi; `check_spec.py` PASS; `npm run build` BUILD_EXIT=0, Compiled successfully, không để lại file lạ)
  Verify: `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 --testPathIgnorePatterns /node_modules/ /.worktrees/ && npx tsc --noEmit -p tsconfig.json && npm run build`

---

# Phần F — Giai đoạn 1 tinh gọn: bỏ S3–S5 khỏi giai đoạn 1, intake_review + dossier_summary dùng kết quả precheck (D-81…D-84; thay PA-2 của D-74)
> Yêu cầu người dùng 2026-10-21: (1) giai đoạn 1 bỏ S3, S4, S5 bằng code (tắt, không xóa); (2) `intake_review` + `dossier_summary` dùng kết quả LLM đánh giá checklist (`dossier_precheck`); (3) S3, S4, S5 chuyển sang giai đoạn 2.
> Lệnh chung: `npx tsc --noEmit -p tsconfig.json`; `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 --testPathIgnorePatterns /node_modules/ /.worktrees/ /.kilo/`; `python docs/loan-appraisal/spec-v3/tools/check_spec.py`.

**Thiết kế (PA-4):**
- Giai đoạn 1 = stage 0 (S1 + `dossier_precheck`) + stage 1 (S2). Rồi `intake_assessment` dựng TỪ precheck, LLM `intake_review` + `dossier_summary` chạy trên dữ kiện đó, rồi `pauseWorkflow` với `currentStep = 3` (giữ nguyên chỉ số điểm dừng; stage 2 chưa có checkpoint nên resume chạy `consolidate_dossier`).
- Giai đoạn 2 = stage 2 (S3→S5, so ngữ nghĩa hoãn, master_dossier, hiệu chỉnh master) + stage 3–7. Resume chạy stage 2 khi chưa có checkpoint (điều kiện `resumeFromStep <= 2 || !consolidate`).
- Tắt bằng tham số, KHÔNG xóa code: `intake_run_consolidate` (mặc định `false`); `true` khôi phục nguyên hành vi cũ (D-51…D-59: S3–S5 chạy ở giai đoạn 1, pause ở bước 3).
- Marker `ClassifyCheckpoint.intake_phase1` (có `intake_assessment`) báo giai đoạn 1 kiểu mới đã xong: resume dùng lại `intake_assessment` đó (không dựng lại từ S4/S5), không gọi lại LLM, không pause lần nữa. Operation cũ (pause ở bước 3, không có marker) chạy như trước.
- `stop_after_intake = false` (chạy một lần): không tách giai đoạn nên S3–S5 chạy ngay sau S2 như trước.
- Output giai đoạn 1: `customer_360 = null`, `checklist` / `cross_check` có `status = NOT_RUN`, `status_code = DEFERRED_TO_PHASE_2`, `master_dossier = null`; `dossier_readiness` và `evidence` dựng từ precheck / S2.
- UI: `consolidate_dossier` chuyển sang phase `CREDIT_APPRAISAL`; giai đoạn 1 có 2 stage; thẻ Người & tài sản / Checklist 46 mục / Đối chiếu chéo ẩn ở giai đoạn 1 kèm ghi chú "chạy ở giai đoạn 2".

**Out-of-scope:** xóa code S3–S5 / `buildIntakeAssessment` (giữ cho `intake_run_consolidate = true` và operation cũ); đổi nội dung prompt `intake_review` / `dossier_summary` (chỉ đổi dữ kiện đầu vào); đổi chỉ số 8 stage; đo chất lượng bằng model thật.
**Rủi ro:** (a) `intake_assessment` giai đoạn 1 chỉ dựa `summary`/`key_facts` + LLM nên bỏ sót hơn S4/S5; (b) mã `ref` của quan hệ do LLM đặt tên nên giải trình (`acknowledgements`) theo mã không ổn định giữa các lần chạy; (c) test cũ phụ thuộc S3–S5 ở điểm dừng phải chuyển sang `intake_run_consolidate = true`; (d) master_dossier và hiệu chỉnh master chỉ có từ giai đoạn 2.

- [x] **F1** Spec (`v2_integration.md`: V2-R21…R24, T-V2-15…17) + BACKLOG + OQ-40 chốt. (đã verify: `build_backlog.py` 178 task + `check_spec.py` PASS, 2026-10-21)
  Verify: `python docs/loan-appraisal/spec-v3/tools/build_backlog.py && python docs/loan-appraisal/spec-v3/tools/check_spec.py`
- [x] **F2** Mô-đun `precheck-intake.ts` (dựng `intake_assessment`, dữ kiện LLM và `dossier_readiness` từ precheck) + test. (đã verify: 17/17 test, `tsc` 0 lỗi, 2026-10-21)
  Verify: `npx jest tests/loan-appraisal-v2/precheck-intake.test.ts`
- [x] **F3** Workflow: tắt S3–S5 ở giai đoạn 1 (cờ `intake_run_consolidate`), pause `currentStep = 2`, resume chạy S3–S5; cập nhật test cũ sang đường `intake_run_consolidate = true` + test đường mới.
  Verify: `npx jest tests/loan-appraisal-v2 tests/loan-appraisal` (đã verify: 33 suite · 324 test pass trên `tests/loan-appraisal-v2 tests/loan-appraisal`, `tsc` 0 lỗi, 2026-10-21)
- [x] **F4** UI / reducer / state-machine: 2 stage giai đoạn 1, ẩn thẻ S3–S5 ở giai đoạn 1 + test.
  Verify: `npx jest tests/loan-appraisal-v2` (đã verify: phase1-lean-ui 10/10 + toàn bộ loan-appraisal-v2 pass, `tsc` 0 lỗi, 2026-10-21)
- [x] **F5** Cổng cuối: hồi quy + `tsc` + `check_spec` + `npm run build`.
  Verify: `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 --testPathIgnorePatterns /node_modules/ /.worktrees/ /.kilo/ && npx tsc --noEmit -p tsconfig.json && npm run build` (đã verify: 119/120 suite · 1215/1216 test (1 lỗi sẵn có parse-field-confidence), `tsc` 0 lỗi, `check_spec` PASS, `npm run build` BUILD_EXIT=0, 2026-10-21)

## Phần F — bổ sung F6 (D-90): sửa điểm dừng giai đoạn 1 (phát hiện qua log vận hành)
> Log thực tế: giai đoạn 1 vẫn chạy hết 23 bước con (8 phân loại, 1 precheck, 12 OCR S2, 2 LLM review/summary) rồi mới dừng. Yêu cầu người dùng: dừng và hiển thị NGAY sau `ext-fact-verifier` của precheck (bước 9).
> Thiết kế sửa: giai đoạn 1 = S1 + `dossier_precheck`, `pauseWorkflow(currentStep = 1)` trước S2. `intake_assessment` giai đoạn 1 dựng bằng quy tắc (không LLM). Resume: S2 → LLM `intake_review` + `dossier_summary` → S3–S5 → stage 3–7. Giải thích lệch so với F3: F3 dừng sau S2 + LLM review/summary (23 bước con); F6 sửa lại cho đúng yêu cầu.
> Out-of-scope: đổi nội dung prompt; xóa code S2–S5.
> Rủi ro: (a) giai đoạn 1 không còn OCR nên tiêu chí 4 (chứng từ lỗi đọc) và `completeness` chỉ có sau giai đoạn 2; (b) tóm tắt giai đoạn 1 chỉ là bản quy tắc (`RULES`), bản LLM chỉ có ở kết quả cuối.
- [ ] **F6** Điểm dừng ngay sau precheck (`currentStep = 1`), review/summary + S2–S5 sang giai đoạn 2, UI 1 stage, test theo DoD T-V2-16/17 mới.
  Verify: `npx jest tests/loan-appraisal-v2 tests/loan-appraisal --testPathIgnorePatterns /node_modules/ /.worktrees/ /.kilo/ && npx tsc --noEmit -p tsconfig.json && python docs/loan-appraisal/spec-v3/tools/check_spec.py && npm run build`
