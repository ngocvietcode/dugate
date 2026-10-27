# Verification: fs-scorer (T-FS-02…04)

Làm bởi Claude (thay Codex) trên nhánh `codex/fs-scorer`, 2026-10-27.

| Bước | Lệnh | Kết quả |
|---|---|---|
| 1 | `npx jest tests/loan-dossier/s3-fs-compare.test.ts --ci` | 10/10 qua |
| 2 | `npx jest tests/loan-dossier/s3-fs-score.test.ts --ci` | 6/6 qua (5 ca §1 + FS-AC05) |
| 3 | `npx jest tests/loan-dossier/s3-fs-shadow.test.ts tests/loan-appraisal/lac-mode-param.test.ts --ci` | 8/8 qua |
| 4 | `npx jest tests/scripts/fs-shadow-report.test.ts --ci` | 1/1 qua |
| 5 | `npx tsc --noEmit` | 0 lỗi |
| 5 | `npx jest --ci` | 337 suite / 3556 test qua; 5 suite / 17 test skip có từ trước |
| 5 | `python docs/loan-appraisal/spec-v3/tools/check_spec.py` | catalogs, links, stages, global OK; ui / backlog FAIL bởi 25 lỗi có từ trước (thiếu Verify ở T-360-01…06, T-LAC-01…07), không lỗi mới |

Lệch plan: thống kê shadow ở `s3_matcher_summary` của kết quả cuối (plan đã ghi), `fs` chưa mở.
