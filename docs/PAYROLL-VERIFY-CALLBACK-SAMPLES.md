# Payroll Verify — Callback Response Format

## Cấu trúc chung

Mọi callback đều có dạng:

```json
{
  "operation_id": "uuid",
  "state": "SUCCEEDED | FAILED",
  "done": true,
  "extracted_data": { ... },   // chỉ khi state = SUCCEEDED
  "error": "message"           // chỉ khi state = FAILED
}
```

---

## Case 1: SUCCESS — Workflow hoàn thành

```json
{
  "operation_id": "ff943c6d-ce86-462f-be95-bfb741038a15",
  "state": "SUCCEEDED",
  "done": true,
  "extracted_data": {
    "request_id": "ff943c6d-ce86-462f-be95-bfb741038a15",
    "skill_code": "payroll-batch-validation",
    "status": "SUCCESS",
    "result": {
      "document_processed": 3,
      "excel_rows": 7,
      "validation_status": "COMPLETED",
      "final_decision": "APPROVED | REVIEW_REQUIRED",
      "pdf_extraction": {
        "thong_tin_chung": {
          "thong_tin_ben_de_nghi_chi_luong": {
            "ten_don_vi_de_nghi": "string | null",
            "ma_kh_cif": "string | null",
            "dia_chi_don_vi_de_nghi": "string | null",
            "so_dien_thoai": "string | null"
          },
          "phuong_thuc_chi_luong": {
            "so_tai_khoan_trich_no": "string | null",
            "ngan_hang_chi_ho": "VPBANK",
            "loai_tien": "VND"
          },
          "thong_tin_chi_luong": {
            "tong_so_tien_bang_so": "string | null",
            "tong_so_tien_bang_chu": "string | null",
            "ngay_lenh_chi": "dd/mm/yyyy | null",
            "noi_dung_thanh_toan": "string | null"
          },
          "thong_ke_tong_quan": {
            "tong_so_nhan_vien": 7,
            "so_nhan_vien_vpbank": 5,
            "so_nhan_vien_ngan_hang_khac": 2
          }
        },
        "danh_sach_trong_vpbank": [
          {
            "stt": 1,
            "ho_ten": "NGUYỄN VĂN A",
            "so_tai_khoan": "433819508",
            "so_tien": "8.000.000",
            "ngan_hang_thu_huong": "VPBANK",
            "loai_tai_khoan": "vpbank"
          }
        ],
        "danh_sach_ngoai_vpbank": []
      },
      "excel_extraction": {
        "thong_tin_chung": { "/* cùng cấu trúc như pdf_extraction */" },
        "danh_sach_trong_vpbank": [
          {
            "stt": 1,
            "ho_ten": "Nguyễn Văn A",
            "so_tai_khoan": "433819508",
            "so_tien": 8000000,
            "ngan_hang_thu_huong": "VPBANK",
            "loai_tai_khoan": "vpbank"
          }
        ],
        "danh_sach_ngoai_vpbank": []
      },
      "comparison_result": {
        "summary": {
          "overall_status": "pass | fail",
          "header_status": "pass | fail",
          "detail_status": "pass | fail",
          "total_source_a_rows": 7,
          "matched_rows": 7,
          "mismatched_rows": 0,
          "missing_in_source_b": 0,
          "extra_in_source_b": 0
        },
        "header_compare": [ "/* chi tiết từng field */" ],
        "detail_results": [ "/* chi tiết từng section */" ]
      }
    }
  }
}
```

---

## Case 2: FAILED — Đầu vào không hợp lệ

Khi file gửi lên không đúng yêu cầu (thiếu file, sai format, file trống).

```json
{
  "operation_id": "abc123",
  "state": "FAILED",
  "done": true,
  "error": "INVALID_INPUT: Cần ít nhất 1 file PDF và 1 file Excel. Nhận được ít hơn 2 file."
}
```

Các error message có thể:
- `INVALID_INPUT: Cần ít nhất 1 file PDF và 1 file Excel...`
- `INVALID_INPUT: Không tìm thấy file PDF/Excel...`
- `EXCEL_PARSE_FAILED: File Excel có N sheets... Hệ thống chỉ chấp nhận file 1 sheet...`
- `EXCEL_PARSE_FAILED: Sheet "X" không đúng format...`
- `EXCEL_EMPTY_DATA: File Excel không chứa bản ghi nhân viên nào...`
- `PDF_SPLIT_FAILED: Không thể đọc file PDF...`
- `PDF_EMPTY: File PDF không có trang nào.`

---

## Case 3: FAILED — Lỗi hệ thống AI (CAIP connector)

Khi connector AI (ext-doc-layout, ext-data-extractor) trả lỗi. Error message từ CAIP được forward nguyên vẹn.

```json
{
  "operation_id": "abc123",
  "state": "FAILED",
  "done": true,
  "error": "Sub-step ext-doc-layout failed: Connection Error to ext-doc-layout: External API returned HTTP 500: {\"detail\":\"(psycopg2.OperationalError) SSL connection has been closed unexpectedly...\"}"
}
```

Hoặc:
```json
{
  "operation_id": "abc123",
  "state": "FAILED",
  "done": true,
  "error": "PDF_OCR_ALL_FAILED: Tất cả 3 trang OCR đều thất bại. Page 1: Sub-step ext-doc-layout failed: ..."
}
```

---

## Quy tắc output fields

### Thông tin chung (`thong_tin_chung`)

Luôn trả đầy đủ các nhóm sau. Field nào không có trên file hoặc AI không đọc được → `null`.

| Nhóm | Field | Kiểu |
|------|-------|------|
| **thong_tin_ben_de_nghi_chi_luong** | ten_don_vi_de_nghi | string \| null |
| | ma_kh_cif | string \| null |
| | dia_chi_don_vi_de_nghi | string \| null |
| | so_dien_thoai | string \| null |
| **phuong_thuc_chi_luong** | so_tai_khoan_trich_no | string \| null |
| | ngan_hang_chi_ho | string (default "VPBANK") |
| | loai_tien | string (default "VND") |
| **thong_tin_chi_luong** | tong_so_tien_bang_so | string \| null |
| | tong_so_tien_bang_chu | string \| null |
| | ngay_lenh_chi | string \| null |
| | noi_dung_thanh_toan | string \| null |
| **thong_ke_tong_quan** | tong_so_nhan_vien | number |
| | so_nhan_vien_vpbank | number |
| | so_nhan_vien_ngan_hang_khac | number |

### Danh sách bản ghi (`danh_sach_trong_vpbank` / `danh_sach_ngoai_vpbank`)

Mỗi record luôn có:

| Field | Kiểu | Mô tả |
|-------|------|-------|
| stt | number | Số thứ tự |
| ho_ten | string | Họ tên người hưởng |
| so_tai_khoan | string | Số tài khoản |
| so_tien | number \| string | Số tiền (Excel: number, PDF: string có dấu chấm) |
| ngan_hang_thu_huong | string | Tên ngân hàng thụ hưởng |
| loai_tai_khoan | "vpbank" \| "ngan_hang_khac" | Phân loại |

---

## Lưu ý

- `source_a` = Excel (ground truth), `source_b` = PDF (OCR)
- `final_decision`: `"APPROVED"` = tất cả khớp, `"REVIEW_REQUIRED"` = có sai lệch cần kiểm tra
- Đầu vào: 1+ file PDF + 1 file Excel (IDP có thể tách PDF lớn thành nhiều file nhỏ)
- Tất cả field trong `thong_tin_chung` luôn có mặt, giá trị `null` nếu không đọc được
