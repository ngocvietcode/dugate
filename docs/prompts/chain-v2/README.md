# LC Document Checker — 3-Step Prompt Chain

## Tổng quan

Gộp từ 6 bước xuống **3 bước**, giảm ~60% token output trung gian.
Chạy trong cùng 1 conversation. AI tự quản lý history.

## Luồng thực thi

```
[Bước 1] Thu thập sự thật (Fact Gathering)
         Input: File L/C + File chứng từ
         Output: Plain text có cấu trúc (KHÔNG phải JSON)
                 + Intermediate Findings (CÓ/KHÔNG)
         Thiết kế: Output dạng plain text giúp AI tập trung đọc chính xác
                   thay vì phân tâm điền JSON schema phức tạp.
              ↓
[Bước 2] Đánh giá + Kiểm tra kép (Evaluate & Audit)
         Input: AI tự đọc history Bước 1
         Output: verified_results JSON (~500 token)
              ↓
[Bước 3] Xuất báo cáo (Report)
         Input: AI tự đọc history Bước 2
         Output: Markdown report (PHẦN A + B + C)
```

## Thiết kế chống đọc sai (v2.1)

Bước 1 ban đầu yêu cầu output JSON phức tạp → AI bị phân tâm giữa đọc file và điền schema
→ đọc sai nhiều trường. Giải pháp:

1. **Plain text output**: Bước 1 output dạng "Tên trường: Giá trị" thay vì JSON.
   AI chỉ cần đọc và ghi lại, không cần lo cấu trúc.
2. **COPY NGUYÊN VĂN**: Các trường quan trọng (45A, 46A, 47A, consignee, mô tả hàng hóa)
   yêu cầu copy nguyên văn từ chứng từ, không paraphrase.
3. **Đánh dấu uncertainty**: Ký tự không chắc → ghi [?]. Không đọc được → ghi [UNREADABLE].
4. **Intermediate Findings dạng CÓ/KHÔNG**: Thay vì boolean JSON, dùng câu hỏi CÓ/KHÔNG
   tự nhiên hơn, AI trả lời chính xác hơn.

## So sánh

| Phiên bản | Bước 1 output | Vấn đề đọc sai |
|-----------|--------------|----------------|
| v2.0 | JSON phức tạp ~800 token | Cao — AI phân tâm |
| v2.1 | Plain text ~1.5K token | Thấp — AI tập trung đọc |

## File

| # | File | Mô tả |
|---|------|-------|
| 1 | `step1_gather.md` | Đọc L/C + chứng từ → xác định sự thật |
| 2 | `step2_evaluate.md` | Đánh giá lỗi + kiểm tra kép |
| 3 | `step3_report.md` | Xuất báo cáo markdown |
