# Báo cáo Unit Test — Margin Deposit Profile Workflow

**Project:** VPBAI-5261 — Hồ sơ ký quỹ
**Module:** `margin-deposit-profile` (DUGate)
**Ngày chạy:** 2026-08-24
**Framework:** Jest 30.3.0 + ts-jest
**Kết quả:** ✅ **77/77 PASSED** (0 failed, 0 skipped)
**Thời gian:** 5.926s

## Tổng quan

| Test Suite | Tests | Kết quả |
|---|---:|---|
| `margin-deposit-profile-compare.test.ts` | 37 | ✅ PASS |
| `margin-deposit-profile-crop.test.ts` | 22 | ✅ PASS |
| `margin-deposit-profile-workflow.test.ts` | 17 | ✅ PASS |
| `margin-deposit-profile-file-cache.test.ts` | 1 | ✅ PASS |
| **Tổng** | **77** | **✅ ALL PASS** |

## Phạm vi kiểm thử

- Chuẩn hóa tên, định danh, tiền, ngày và chuỗi.
- UC-04: đúng 04 bản mới có thể `MATCH`; thiếu/thừa bản, thiếu field, null field hoặc output rỗng không tạo false positive.
- Parse/crop page range: trang đơn, range, disjoint range, clamp theo số trang PDF thật, range cực lớn/dài/phân mảnh.
- Crop lifecycle: lưu `original_page_numbers`, không xóa source local, xóa temp download thuộc operation, cleanup partial upload.
- Input identity: filename trùng vẫn có `file_id` riêng; reject explicit `file_id` trùng.
- Runtime schema validation: classify, extraction, presence và framework AI output.
- Presence policy: absent → `FAIL`; uncertain/execution error → `WARNING`.
- Presence location: nhiều chữ ký/con dấu trên một trang, `box_2d` chuẩn hóa 0–1000, nullable location, reject thiếu trang/type/toạ độ/bounds/confidence sai, reject trạng thái mâu thuẫn với detections và tương thích output legacy.
- Framework parser: scalar URL, `url`, `file_url`, trim input, giới hạn `total_chunks`.
- FileCache lifecycle: release `refCount`, không xóa trực tiếp canonical shared `s3Key`.
- Runtime config: mode validation, clamp concurrency/stagger/deadline và cap sub-step wait theo deadline còn lại.

## Validation bổ sung

| Kiểm tra | Kết quả |
|---|---|
| TypeScript `tsc --noEmit` | ✅ `TSC_EXIT_0` |
| Workflow failure/progress regression | ✅ 24/24 PASS |
| Auth/downloader regression (`tests/auth-config`) | ✅ 39/39 PASS |
| `git diff --check` | ✅ PASS |
| Independent bbox review | ✅ 0 critical; 3 semantic warnings đã được khắc phục |
| IDE diagnostics | ✅ 0 diagnostics |

## Lệnh chạy

```cmd
pushd D:\RPA\DUGate
node_modules\.bin\jest.cmd --testPathPatterns=margin-deposit-profile --runInBand --no-coverage
node_modules\.bin\tsc.cmd --noEmit
popd
```

## Giới hạn còn lại

- Chưa phải E2E với AI connector và PDF nghiệp vụ thật; cần chạy bộ ground-truth riêng, bao gồm đánh giá độ chính xác `box_2d` cho chữ ký/con dấu.
- Deadline hiện remove được job chưa chạy và giới hạn thời gian parent chờ; HTTP request đã active chỉ có thể hủy thật khi AbortSignal được truyền xuyên BullMQ worker/connector.