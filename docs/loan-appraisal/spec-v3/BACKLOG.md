# BACKLOG

> **File sinh tự động** bởi `tools/build_backlog.py` từ các task card. Không sửa tay; sửa task card rồi chạy lại.
> Theo dõi tiến độ ở `PLAN.md` (milestone) và `IMPLEMENT.md` (nhật ký); file này không lưu trạng thái.
> Nền v2 (D-32): triển khai trong workflow `loan-appraisal` 8 stage — xem `cross_cutting/v2_integration.md`.

Tổng: **151 task cần làm**, 19 lớp song song + 3 cổng cuối; 57 task không áp dụng trên nền v2 (cuối file).

Cách dùng: chọn task ở lớp thấp nhất chưa xong; mọi `Depends` đã xong mới làm. Trong cùng một lớp, các task độc lập — có thể giao song song.

## Lớp 1 (7 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-01 | Nền: bất biến và hàm trust thuần | — | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/context-properties.test.ts` |
| T-CAT-01 | Script đồng bộ catalog vào code | — | `cross_cutting/foundation.md` | `npm run sync:loan-catalogs && npx jest tests/loan-dossier/catalog-sync.test.ts` |
| T-LAC-01 | Hợp đồng LAC | — | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-dossier/context-build.test.ts tests/loan-appraisal-v2` |
| T-S1-03 | Chia batch PDF và ghép segment | — | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-batching.test.ts` |
| T-S2-03 | Chuẩn hóa giá trị | — | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/common-normalize.test.ts` |
| T-S3-02 | Tách chủ sở hữu ghép | — | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-split-names.test.ts` |
| T-SEC-01 | Che dữ liệu (hàm thuần) | — | `cross_cutting/security.md` | `npx jest tests/loan-dossier/mask.test.ts` |

## Lớp 2 (9 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-02 | Lớp 2 | T-360-01 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-CAT-02 | Bộ nạp catalog dùng chung | T-CAT-01 | `cross_cutting/foundation.md` | `npx jest tests/loan-dossier/catalog-index.test.ts` |
| T-COM-01 | Chuẩn hóa và so khớp tên | T-S2-03 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/common-name.test.ts` |
| T-COM-02 | So khớp số định danh | T-S2-03 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/common-id-number.test.ts` |
| T-LAC-02 | Gộp chủ thể khoản vay và hộ kinh doanh | T-LAC-01 | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-dossier/context-build.test.ts` |
| T-S2-06 | Khóa trùng (`dedup_key`) | T-S2-03 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-dedup-key.test.ts` |
| T-S3-07 | Khóa và nối tài sản | T-S2-03 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-asset-key.test.ts` |
| T-S4-02 | Hiệu lực chứng từ (hàm dùng chung S3/S4) | T-S2-03 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/common-validity.test.ts` |
| T-S5-03 | So khớp `EXACT` | T-S2-03 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-compare-exact.test.ts` |

## Lớp 3 (17 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-03 | Tài chính đọc lớp 2 | T-360-02 | `cross_cutting/loan_360.md` | `npx jest tests/loan-appraisal/v2-financial-inputs.test.ts tests/loan-appraisal/segment-packs.test.ts` |
| T-360-07 | P0: Hộ kinh doanh | T-360-02 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-360-10 | Catalog chính sách chọn giá trị | T-360-02 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-360-15 | P3: Địa chỉ | T-360-02 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-360-17 | P3: Giấy tờ định danh | T-360-02 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-FS-02 | Bộ so sánh và catalog tham số | T-COM-01, T-COM-02 | `cross_cutting/s3_fellegi_sunter.md` | `npx jest tests/loan-dossier/s3-fs-compare.test.ts` |
| T-LAC-03 | Dữ kiện, trạng thái, mâu thuẫn, khoảng trống | T-LAC-02 | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-dossier/context-build.test.ts` |
| T-S1-01 | Nhận dạng định dạng và `file_id` | T-CAT-02 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-file-id.test.ts` |
| T-S1-02 | Bảng trạng thái file → mã lý do | T-CAT-02 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-file-status.test.ts` |
| T-S2-01 | Nạp schema chứng từ (registry zod) | T-CAT-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-registry.test.ts` |
| T-S2-02 | Schema zod dùng chung (Party, Asset, Address, LegalInfo, EvidenceEnvelope) | T-CAT-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-common-schema.test.ts` |
| T-S2-07 | Trạng thái nhóm trùng | T-S2-06 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-duplicates.test.ts` |
| T-S3-08 | Gom nhóm tài sản (union-find) và nối gần đúng | T-S3-07 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-asset-group.test.ts` |
| T-S3-10 | Loại quan hệ | T-COM-01 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-relationship.test.ts` |
| T-S4-01 | Nạp và kiểm tra catalog checklist | T-CAT-02 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-catalog.test.ts` |
| T-S5-01 | Nạp và kiểm tra ma trận | T-CAT-02 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-matrix.test.ts` |
| T-S5-07 | Quy tắc số định danh và bản trùng | T-S5-03 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-id-and-dup.test.ts` |

## Lớp 4 (52 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-04 | Lưu và áp quyết định | T-360-03 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/context-resolutions.test.ts` |
| T-360-08 | P1: Khóa mã số thuế, giao dịch, mặt bằng, nghĩa vụ | T-360-07 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360-relations.test.ts` |
| T-360-11 | P1: Nghĩa vụ nợ | T-360-10 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360-obligations.test.ts` |
| T-360-12 | P1: Nguồn thu | T-360-07, T-360-10 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-360-14 | P2: Định giá | T-360-10 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360-valuations.test.ts` |
| T-360-16 | P3: Hộ gia đình | T-360-15 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-CON-01 | Hợp đồng `StageResult` và `data` của S1, S2 | T-CAT-02, T-S2-02 | `04_data_model.md` | `npx jest tests/loan-dossier/contract-stage-result.test.ts` |
| T-DOC-01 | Schema id_card | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-id_card.test.ts` |
| T-DOC-02 | Schema vneid | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-vneid.test.ts` |
| T-DOC-03 | Schema qr_code_info | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-qr_code_info.test.ts` |
| T-DOC-04 | Schema residence_confirmation | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-residence_confirmation.test.ts` |
| T-DOC-05 | Schema marital_status_confirmation | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-marital_status_confirmation.test.ts` |
| T-DOC-06 | Schema local_cmnd_confirmation | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-local_cmnd_confirmation.test.ts` |
| T-DOC-07 | Schema same_person_commitment | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-same_person_commitment.test.ts` |
| T-DOC-08 | Schema marriage_certificate | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-marriage_certificate.test.ts` |
| T-DOC-09 | Schema birth_certificate | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-birth_certificate.test.ts` |
| T-DOC-10 | Schema loan_application | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-loan_application.test.ts` |
| T-DOC-11 | Schema purchase_list | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-purchase_list.test.ts` |
| T-DOC-12 | Schema goods_purchase_contract | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-goods_purchase_contract.test.ts` |
| T-DOC-13 | Schema vehicle_sale_contract | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-vehicle_sale_contract.test.ts` |
| T-DOC-14 | Schema labor_contract | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-labor_contract.test.ts` |
| T-DOC-15 | Schema salary_confirmation | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-salary_confirmation.test.ts` |
| T-DOC-16 | Schema income_statement | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-income_statement.test.ts` |
| T-DOC-17 | Schema land_use_certificate | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-land_use_certificate.test.ts` |
| T-DOC-18 | Schema apartment_ownership_certificate | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-apartment_ownership_certificate.test.ts` |
| T-DOC-19 | Schema land_use_cert_to_buy | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-land_use_cert_to_buy.test.ts` |
| T-DOC-20 | Schema vehicle_registration | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-vehicle_registration.test.ts` |
| T-DOC-21 | Schema vehicle_inspection | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-vehicle_inspection.test.ts` |
| T-DOC-22 | Schema real_estate_valuation_report | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-real_estate_valuation_report.test.ts` |
| T-DOC-23 | Schema movable_asset_valuation_report | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-movable_asset_valuation_report.test.ts` |
| T-DOC-24 | Schema asset_quote | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-asset_quote.test.ts` |
| T-DOC-25 | Schema external_valuation_certificate | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-external_valuation_certificate.test.ts` |
| T-DOC-26 | Schema cic | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-cic.test.ts` |
| T-DOC-27 | Schema credit_contract | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-schema-credit_contract.test.ts` |
| T-FS-03 | Bộ chấm, quyết định và chế độ `s3_matcher` | T-FS-02 | `cross_cutting/s3_fellegi_sunter.md` | `npx jest tests/loan-dossier/s3-fs-score.test.ts tests/loan-dossier/s3-match-parties.test.ts` |
| T-LAC-04 | Render và bảng mã | T-LAC-03 | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-dossier/context-render.test.ts` |
| T-S1-04 | Hậu xử lý kết quả model | T-S1-02, T-CAT-02 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-postprocess.test.ts` |
| T-S2-04 | Chủ sở hữu hiện tại trong 1 chứng từ | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-current-owner.test.ts` |
| T-S2-05 | Hạ confidence khi đọc nhầm trang | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-page-guard.test.ts` |
| T-S2-08 | Cổng gọi model trích xuất | T-S2-01 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-extractor-port.test.ts` |
| T-S2-10 | Bóc tách nhẹ (`LIGHT`) | T-S2-02 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-light.test.ts` |
| T-S3-01 | Chọn anchor | T-S2-02 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-anchor.test.ts` |
| T-S3-11 | Xác minh qua giấy khai sinh | T-S3-10, T-COM-01 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-birth-cert.test.ts` |
| T-S4-03 | Đánh giá điều kiện bằng rule | T-S4-01 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-conditions-rule.test.ts` |
| T-S4-04 | Đánh giá điều kiện ngữ nghĩa (LLM) | T-S4-01 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-conditions-llm.test.ts` |
| T-S4-05 | Sinh dòng checklist | T-S4-01 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-rows.test.ts` |
| T-S5-02 | Thu thập giá trị theo (người | tài sản) × nhóm | T-S5-01 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-collect.test.ts` |
| T-S5-04 | Địa chỉ so trên bề mặt chứng từ | T-S5-01 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-address.test.ts` |
| T-S5-05 | So khớp `METRIC` | T-S5-01 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-metric.test.ts` |
| T-S5-06 | So khớp `SEMANTIC` (LLM) | T-S5-01 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-semantic.test.ts` |
| T-S5-09 | Logic rule liên chứng từ | T-S5-01 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-logic-rules.test.ts` |
| T-TEST-01 | Bộ dựng fixture giả | T-S2-02 | `cross_cutting/test.md` | `npx jest tests/loan-dossier/fixtures-build.test.ts` |

## Lớp 5 (14 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-05 | Tính lại | T-360-04 | `cross_cutting/loan_360.md` | `npx jest tests/loan-appraisal/recompute.test.ts` |
| T-360-06 | Giao diện CO | T-360-04 | `cross_cutting/loan_360.md` | `npx jest tests/loan-appraisal-v2/co-resolution-view.test.ts` |
| T-360-09 | P2: Doanh nghiệp (SME) | T-360-08 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360-sme.test.ts` |
| T-360-18 | P3: Đối tác | T-360-08 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-CON-02 | Hợp đồng `data` của S3–S6 | T-CON-01 | `04_data_model.md` | `npx jest tests/loan-dossier/contract-check-stages.test.ts` |
| T-FS-04 | Báo cáo shadow | T-FS-03 | `cross_cutting/s3_fellegi_sunter.md` | `npx jest tests/scripts/fs-shadow-report.test.ts` |
| T-LAC-05 | Nối vào Rule LLM | T-LAC-04 | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-appraisal/prompt-checks-lac.test.ts tests/loan-appraisal/lac-mode-param.test.ts` |
| T-S1-05 | Tín hiệu nghi trùng mức loại | T-S1-04 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-repeated.test.ts` |
| T-S1-06 | Cổng gọi model phân loại | T-S1-03, T-S1-04 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-classifier-port.test.ts` |
| T-S2-09 | Lắp ráp stage S2 | T-S2-04, T-S2-05, T-S2-07, T-S2-08, T-S2-10 | `stages/S2_extract_evidence.md` | `npx jest tests/loan-dossier/s2-run.test.ts` |
| T-S3-03 | Dựng role registry từ anchor | T-S3-01, T-S3-02, T-COM-01, T-COM-02 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-registry.test.ts` |
| T-S4-06 | Xác định `required` | T-S4-03 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-required.test.ts` |
| T-S5-08 | Dòng từ `identifier_conflicts` | T-S5-02 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-identifier-conflicts.test.ts` |
| T-V2-10 | Bảng ánh xạ và bộ chấm UAT | T-CAT-02, T-S2-10 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-uat-map.test.ts` |

## Lớp 6 (8 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-360-13 | P2: Giao dịch mua | T-360-18 | `cross_cutting/loan_360.md` | `npx jest tests/loan-dossier/profile360.test.ts` |
| T-FS-06 | Đánh giá và bật `fs` | T-FS-04 | `cross_cutting/s3_fellegi_sunter.md` | `npx jest tests/scripts/fs-estimate-params.test.ts tests/loan-dossier/s3-fs-compare.test.ts tests/loan-dossier/s3-fs-score.test.ts` |
| T-LAC-06 | Lưu trữ, an toàn, tài liệu | T-LAC-05 | `cross_cutting/loan_application_context.md` | `npx jest tests/loan-appraisal/lac-pii.test.ts` |
| T-LAC-07 | Đo trên UAT và quyết định bật | T-LAC-05 | `cross_cutting/loan_application_context.md` | `npx jest tests/scripts/lac-compare.test.ts` |
| T-S1-07 | Lắp ráp stage S1 | T-S1-01, T-S1-02, T-S1-04, T-S1-05, T-S1-06 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1-run.test.ts` |
| T-S3-04 | Ghép party chứng từ khác theo số, rồi theo tên | T-S3-03 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-match-parties.test.ts` |
| T-S4-07 | Quyết định trạng thái dòng | T-S4-02, T-S4-05, T-S4-06 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-row-status.test.ts` |
| T-S5-10 | Lắp ráp stage S5 | T-S5-04, T-S5-05, T-S5-06, T-S5-07, T-S5-08, T-S5-09 | `stages/S5_cross_check_documents.md` | `npx jest tests/loan-dossier/s5-run.test.ts` |

## Lớp 7 (8 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-FS-01 | Vá S3: không ghép theo tên khi số và ngày sinh cùng khác | T-S3-04 | `cross_cutting/s3_fellegi_sunter.md` | `npx jest tests/loan-dossier/s3-match-parties.test.ts` |
| T-S1-08 | Tóm tắt và `key_facts` theo danh mục cố định | T-S1-04, T-S1-06, T-S1-07 | `stages/S1_classify.md` | `npx jest tests/loan-dossier/s1- tests/loan-dossier/contract-stage-result.test.ts` |
| T-S3-05 | Dựng `unmapped_evidences` | T-S3-04 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-unmapped.test.ts` |
| T-S3-06 | Số định danh hiện tại / lịch sử / kiểm tra | T-S3-04, T-COM-02 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-id-check.test.ts` |
| T-S3-09 | Chọn thuộc tính tài sản, chủ sở hữu, ngữ cảnh | T-S3-08, T-S3-04 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-asset-attrs.test.ts` |
| T-S4-08 | Giấy khai sinh | T-S4-07 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-birth-cert.test.ts` |
| T-S4-09 | Tổng hợp và trạng thái stage | T-S4-07 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-summary.test.ts` |
| T-V2-01 | Stage 0 chạy S1 | T-S1-07 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-stage-classify.test.ts` |

## Lớp 8 (4 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-S3-16 | Bản bị thay thế (bản cũ hết hiệu lực) | T-S3-04, T-S3-09, T-S4-02 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-superseded.test.ts` |
| T-S4-10 | Lắp ráp stage S4 | T-S4-04, T-S4-08, T-S4-09 | `stages/S4_check_checklist.md` | `npx jest tests/loan-dossier/s4-run.test.ts` |
| T-V2-02 | Stage 1 chạy S2 | T-S2-09, T-V2-01 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-stage-extract.test.ts` |
| T-V2-12 | Mô-đun kiểm tra sơ bộ `dossier-precheck` | T-S1-08, T-V2-01 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/dossier-precheck.test.ts` |

## Lớp 9 (4 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-S3-12 | Customer 360 | T-S3-06, T-S3-09, T-S3-16 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-customer360.test.ts` |
| T-V2-04 | EvidenceRegistry từ EvidenceEnvelope | T-S2-02, T-S3-16 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-evidence-registry.test.ts` |
| T-V2-14 | Hiển thị kiểm tra sơ bộ ở giai đoạn 1 | T-V2-12 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/precheck-ui.test.ts` |
| T-V2-15 | Dựng `intake_assessment` từ kết quả kiểm tra sơ bộ | T-V2-12 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/precheck-intake.test.ts` |

## Lớp 10 (5 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-S3-13 | Trạng thái stage + `content_preview` | T-S3-05, T-S3-09, T-S3-12 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-status.test.ts` |
| T-S3-14 | Kiểm tra nhất quán output | T-S3-12 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-invariants.test.ts` |
| T-V2-06 | Đầu vào tài chính theo spec | T-V2-04, T-DOC-10, T-DOC-16, T-DOC-22, T-DOC-25 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-financial-inputs.test.ts` |
| T-V2-07 | Rule và cấu hình rule theo khóa spec | T-V2-04, T-S4-10 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-rules.test.ts` |
| T-V2-13 | Nối bước kiểm tra sơ bộ vào stage 0 | T-V2-12, T-V2-14 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/dossier-precheck-workflow.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts` |

## Lớp 11 (2 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-S3-15 | Lắp ráp stage S3 | T-S3-04, T-S3-05, T-S3-06, T-S3-09, T-S3-11, T-S3-12, T-S3-13, T-S3-14, T-S3-16 | `stages/S3_map_dossier_roles.md` | `npx jest tests/loan-dossier/s3-run.test.ts` |
| T-V2-16 | Giai đoạn 1 dừng ngay sau kiểm tra sơ bộ; S2–S5 và LLM review sang giai đoạn 2 | T-V2-15, T-V2-13 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/phase1-lean.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts` |

## Lớp 12 (3 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-V2-03 | Stage 2 chạy S3 → S4 → S5 | T-S3-15, T-S4-10, T-S5-10, T-V2-02 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-stage-consolidate.test.ts` |
| T-V2-05 | Customer 360 và truy nguồn từ S3 | T-S3-15, T-V2-04 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-master-data.test.ts` |
| T-V2-17 | Giao diện giai đoạn 1 tinh gọn | T-V2-16 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2/phase1-lean-ui.test.ts tests/loan-appraisal-v2/run-reducer.test.ts` |

## Lớp 13 (2 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-01 | Hợp đồng `master_dossier` | T-V2-03 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-dossier/md-contract.test.ts` |
| T-V2-08 | Output và payload tích hợp theo shape mới | T-V2-03, T-V2-05 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-output.test.ts` |

## Lớp 14 (3 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-02 | Hợp nhất bản trùng của một chứng từ | T-MD-01 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-dossier/md-document.test.ts` |
| T-V2-09 | Giao diện `/loan-appraisal-v2` theo shape mới | T-V2-08 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal-v2` |
| T-V2-11 | Gỡ phần cũ | T-V2-03, T-V2-05, T-V2-07, T-V2-08 | `cross_cutting/v2_integration.md` | `npx jest tests/loan-appraisal/v2-no-legacy.test.ts` |

## Lớp 15 (1 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-03 | Người và tài sản hợp nhất theo S5 | T-MD-02 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-dossier/md-entity.test.ts` |

## Lớp 16 (2 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-04 | Chạy trong stage 2, output và payload | T-MD-03, T-V2-08 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-master-dossier.test.ts` |
| T-MD-09 | Hợp đồng `CORRECTED` và đề xuất hiệu chỉnh | T-MD-03 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-dossier/md-correct.test.ts tests/loan-dossier/md-document.test.ts` |

## Lớp 17 (5 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-05 | Giao diện master theo checklist | T-MD-04, T-V2-09 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal-v2/master-view.test.ts` |
| T-MD-06 | Rule engine đọc `master.*` | T-MD-04, T-V2-07 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-rules-master.test.ts` |
| T-MD-07 | Prompt Rule LLM dùng khối master | T-MD-04, T-V2-07 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-prompt-master.test.ts` |
| T-MD-08 | Đầu vào tài chính từ master | T-MD-04, T-V2-06 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-financial-master.test.ts` |
| T-MD-10 | Áp dụng quyết định hiệu chỉnh | T-MD-09 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-dossier/md-correct.test.ts` |

## Lớp 18 (1 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-11 | Lời gọi LLM, checkpoint, nối vào workflow | T-MD-10, T-V2-08 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-master-correction.test.ts tests/loan-appraisal-v2/stop-after-intake.test.ts` |

## Lớp 19 (1 task)

| Task | Tiêu đề | Phụ thuộc | Spec | Verify |
|---|---|---|---|---|
| T-MD-12 | Các bước sau dùng giá trị hiệu chỉnh, giao diện | T-MD-11 | `cross_cutting/master_dossier.md` | `npx jest tests/loan-appraisal/v2-master-correction-downstream.test.ts tests/loan-appraisal/v2-master-dossier.test.ts tests/loan-appraisal/v2-intake-assessment.test.ts tests/loan-appraisal-v2/master-view.test.ts` |

## Cổng cuối (sau mọi task code)

| Task | Tiêu đề | Spec | Verify |
|---|---|---|---|
| T-SEC-05 | Kiểm tra trước khi báo xong | `cross_cutting/security.md` | `node -e "const r=require('child_process').spawnSync('git',['grep','-n','-I','-E','dg_[A-Za-z0-9_-]{30,}'],{stdio:'inherit'});process.exit(r.status===1?0:1)" && npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2` (chạy được trên PowerShell 7 và bash; `git grep` trả 1 khi không có kết quả)` |
| T-TEST-02 | Mọi AC có test | `cross_cutting/test.md` | `npx jest tests/loan-dossier/spec-ac-coverage.test.ts` |
| T-TEST-04 | Toàn bộ test của luồng | `cross_cutting/test.md` | `npx jest tests/loan-dossier tests/loan-appraisal tests/loan-appraisal-v2 && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build` |

## Không áp dụng trên nền v2 (D-32)

Giữ trong spec để tra cứu; không làm, không tính vào lớp.

| Task | Tiêu đề | Spec |
|---|---|---|
| T-API-01 | Tài liệu tích hợp cho hệ thống ngoài | `cross_cutting/api.md` |
| T-API-02 | Client gọi W1/W2 cho giao diện (hàm thuần) | `cross_cutting/api.md` |
| T-CON-03 | Hợp đồng `OcrOutput` (W1) | `04_data_model.md` |
| T-CON-04 | Hợp đồng `CheckInput` và `CheckOutput` (W2) | `04_data_model.md` |
| T-EDIT-01 | Áp bản vá lên evidence (hàm thuần) | `cross_cutting/foundation.md` |
| T-NAV-01 | Điều hướng | `cross_cutting/rbac.md` |
| T-RUN-02 | Lập lịch stage | `cross_cutting/foundation.md` |
| T-RUN-03 | Workflow W1 `loan-dossier-ocr` | `cross_cutting/foundation.md` |
| T-RUN-04 | Workflow W2 `loan-dossier-check` | `cross_cutting/foundation.md` |
| T-RUN-05 | Đăng ký hai workflow trong endpoint registry | `cross_cutting/foundation.md` |
| T-RUN-06 | Port `StageRunner` và bản giả lập | `cross_cutting/foundation.md` |
| T-RUN-07 | Cắm engine thật vào `StageRunner` | `cross_cutting/foundation.md` |
| T-S6-01 | Schema `sl_input` và chuẩn hóa | `stages/S6_compare_ocr_sl.md` |
| T-S6-02 | Ghép block người SL ↔ `person_id` | `stages/S6_compare_ocr_sl.md` |
| T-S6-03 | Ghép block TSBĐ ↔ `asset_id` | `stages/S6_compare_ocr_sl.md` |
| T-S6-04 | Lấy giá trị OCR của một field | `stages/S6_compare_ocr_sl.md` |
| T-S6-05 | Quyết định trạng thái một dòng | `stages/S6_compare_ocr_sl.md` |
| T-S6-06 | Gợi ý giá trị chuẩn | `stages/S6_compare_ocr_sl.md` |
| T-S6-08 | Trạng thái stage + `content_preview` | `stages/S6_compare_ocr_sl.md` |
| T-S6-09 | Lắp ráp stage S6 | `stages/S6_compare_ocr_sl.md` |
| T-SEC-02 | Quét mã nguồn: không lưu trạng thái | `cross_cutting/security.md` |
| T-SEC-03 | Quét mã nguồn: không `localStorage`, không PII trong log | `cross_cutting/security.md` |
| T-SEC-04 | Giới hạn kích thước đầu vào W2 | `cross_cutting/security.md` |
| T-TEST-03 | Smoke test với hạ tầng thật (chạy tay) | `cross_cutting/test.md` |
| T-U1-01 | Danh sách tệp và chặn trùng (hàm thuần) | `ui/U1_create_upload.md` |
| T-U1-02 | Danh sách stage và trạng thái hiển thị (hàm thuần) | `ui/U1_create_upload.md` |
| T-U1-03 | Reducer phiên chạy (hàm thuần) | `ui/U1_create_upload.md` |
| T-U1-04 | Ánh xạ operation sang action (hàm thuần) | `ui/U1_create_upload.md` |
| T-U1-05 | Tham số URL | `ui/U1_create_upload.md` |
| T-U1-06 | Hook chạy và mở lại | `ui/U1_create_upload.md` |
| T-U1-07 | Khung trang và cột trái | `ui/U1_create_upload.md` |
| T-U1-08 | Nâng cấp `PageShell` (tiêu đề và liên kết) | `ui/U1_create_upload.md` |
| T-U1-09 | Nâng cấp `UploadDropzone` (đuôi file và chữ phụ) | `ui/U1_create_upload.md` |
| T-U1-10 | Nâng cấp `StageList` (danh sách stage truyền vào) | `ui/U1_create_upload.md` |
| T-U1-11 | Nâng cấp `RunControls` (nhãn và nút phụ) | `ui/U1_create_upload.md` |
| T-U1-12 | Kiểm tương thích ngược của các thành phần v2 đã nâng cấp | `ui/U1_create_upload.md` |
| T-U2-01 | View-model phân loại chứng từ | `ui/U2_review_ocr.md` |
| T-U2-02 | Làm phẳng evidence thành dòng bảng | `ui/U2_review_ocr.md` |
| T-U2-03 | Danh sách "Việc cần hoàn tất" | `ui/U2_review_ocr.md` |
| T-U2-04 | Kiểm giá trị sửa | `ui/U2_review_ocr.md` |
| T-U2-05 | Kho bản vá phía giao diện (hàm thuần) | `ui/U2_review_ocr.md` |
| T-U2-06 | Các thẻ Giai đoạn 1 | `ui/U2_review_ocr.md` |
| T-U3-01 | Kiểu `ConfirmationPayload` (zod) | `ui/U3_confirm_customer.md` |
| T-U3-02 | Tách `ConfirmationPayload` thành `sl_input` và `external_input` | `ui/U3_confirm_customer.md` |
| T-U3-03 | Kiểm tra trước khi gửi | `ui/U3_confirm_customer.md` |
| T-U3-04 | Gợi ý điền sẵn từ OCR | `ui/U3_confirm_customer.md` |
| T-U3-05 | Reducer trạng thái form | `ui/U3_confirm_customer.md` |
| T-U3-07 | Thẻ xác nhận (thành phần giao diện) | `ui/U3_confirm_customer.md` |
| T-U3-08 | Dựng `CheckInput` và gửi W2 (hàm thuần) | `ui/U3_confirm_customer.md` |
| T-U3-09 | Đánh giá ngưỡng tự động (hàm thuần) | `ui/U3_confirm_customer.md` |
| T-U3-10 | Dựng bản xác nhận tự động (hàm thuần) | `ui/U3_confirm_customer.md` |
| T-U4-01 | View-model checklist | `ui/U4_results.md` |
| T-U4-02 | View-model đối chiếu chéo | `ui/U4_results.md` |
| T-U4-03 | View-model bảng OCR ↔ SL | `ui/U4_results.md` |
| T-U4-04 | View-model tổng quan, người & tài sản | `ui/U4_results.md` |
| T-U4-05 | Xuất CSV ở trình duyệt (hàm thuần) | `ui/U4_results.md` |
| T-U4-06 | Các thẻ Giai đoạn 2 | `ui/U4_results.md` |
