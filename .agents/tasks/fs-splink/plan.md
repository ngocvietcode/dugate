# Plan: Ước lượng tham số Fellegi-Sunter bằng Splink (T-FS-05)

Spec: `docs/loan-appraisal/spec-v3/cross_cutting/s3_fellegi_sunter.md` §4, FS-R10…R13.
Nhánh: `codex/fs-splink`, tách từ `codex/fs-scorer` **sau khi bước 1 của `.agents/tasks/fs-scorer/plan.md` xong** (cần schema
`fs_params.json` và `lib/loan-dossier/s3/fs/compare.ts`). Test tối thiểu. Python: `python` (3.14 đã cài), luôn chạy với `-I`.

## Ràng buộc

- **Không dữ liệu thật trong repo** (SECURITY-RULES #10, FS-R13). Mọi chạy thử dùng dữ liệu giả sinh trong script. Thư mục xuất mặc định
  nằm ngoài repo (tham số `--out`), README ghi rõ.
- Splink và gói Python khác ghim **phiên bản chính xác** trong `scripts/er/requirements.txt`; chọn bản phát hành ổn định đã có ít nhất
  vài tuần, ghi lý do chọn trong README.
- Không gọi mạng trong script ngoài việc đọc Operation như `scripts/lac-shadow-report.ts` (fetch qua `ssrfSafeFetch` + timeout).

## Bước

- [ ] 1. **Vector chuẩn dùng chung.** `tests/loan-dossier/fixtures/fs-vectors.json`: ~15 cặp giá trị **giả** (party A, party B → mức mong
      đợi của từng trường §3.2). Test TS `tests/loan-dossier/s3-fs-vectors.test.ts` chạy `comparePair` trên file này.
      Verify: `npx jest tests/loan-dossier/s3-fs-vectors.test.ts --ci`
- [ ] 2. **Xuất bản ghi.** `scripts/er/export-er-records.ts`: đọc Operation (như `lac-shadow-report.ts`), mỗi party cá nhân → một dòng
      `operation_id, party_key, <các trường đã chuẩn hóa>, confidence`, thêm cột mức đã tính sẵn cho cặp trong cùng Operation
      (`comparePair`) để Splink không phải viết lại `nameLevel` / `NEAR` / `id_structure` (spec §4 bước 2). Ghi CSV (không cần parquet).
      Verify: `npx tsx scripts/er/export-er-records.ts --demo --out <thư mục tạm>` sinh file từ dữ liệu giả.
- [ ] 3. **Ước lượng.** `scripts/er/estimate.py`: Splink, blocking `operation_id`, comparisons đọc cột mức đã tính sẵn; `u` lấy mẫu trong cùng
      hồ sơ (FS-R10); `m` bằng EM; mức có < 30 cặp → giữ giá trị chuyên gia từ `fs_params.json` hiện tại và ghi vào báo cáo; thứ tự trọng
      số sai (`AGREE` ≤ `DISAGREE`) → dừng, không xuất.
      `scripts/er/to_fs_params.py`: ghi `fs_params.json` đúng schema, tăng `params_version`, `source = "SPLINK"`.
- [ ] 4. **Tương đương mức (FS-R11).** `scripts/er/check_parity.py`: đọc `fs-vectors.json`, áp cấu hình comparison của Splink, so mức với
      cột mong đợi; lệch → exit 1.
      Verify: `python -I scripts/er/check_parity.py`
- [ ] 5. **README** `scripts/er/README.md`: môi trường chạy, cài đặt, thứ tự lệnh, chỗ để dữ liệu xuất, ai duyệt `params_version` (OQ-FS-03).
      Ghi kết quả Verify vào `.agents/tasks/fs-splink/verification.md`.
