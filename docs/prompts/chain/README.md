# LC Document Checker — Prompt Chain Architecture v2

## Tổng quan

Hệ thống 6 prompt chain, thiết kế để chạy **trong cùng 1 conversation**.
AI tự quản lý history — KHÔNG cần copy/paste JSON giữa các bước.

## Chiến lược quản lý context

Vấn đề: Nếu mỗi bước output JSON đầy đủ (~3-5K token), đến Prompt 4-5 tổng context
sẽ lên 30-50K token → hiệu ứng "lost-in-the-middle".

Giải pháp: **Compact Output Protocol**
- Mỗi bước output 2 phần:
  1. `[FULL]` — JSON đầy đủ (AI tự lưu trong history)
  2. `[COMPACT]` — Tóm tắt ≤500 token chứa CHỈ dữ liệu cần cho bước tiếp theo
- Bước sau CHỈ cần đọc `[COMPACT]` của bước trước + `[FULL]` khi cần tra cứu chi tiết
- Giảm "working memory" từ ~30K xuống ~5K token tại mỗi bước

## Luồng thực thi (trong cùng session)

```
User: [Đính kèm file L/C + chứng từ]
      "Chạy Prompt 1" + paste nội dung 01_parse_lc.md

AI:   → Output [FULL] lc_requirements JSON
      → Output [COMPACT] tóm tắt L/C

User: "Chạy Prompt 2" + paste nội dung 02_extract_docs.md
      (AI tự thấy file đính kèm + [COMPACT] từ Prompt 1 trong history)

AI:   → Output [FULL] extracted_data JSON
      → Output [COMPACT] tóm tắt dữ liệu chứng từ

... tiếp tục đến Prompt 6
```

## Luồng thực thi (khác session / qua API)

Nếu chạy qua API pipeline (DUGate/SkillHub) hoặc khác session:
- Bắt buộc truyền `[COMPACT]` output của các bước trước vào input bước sau
- Truyền `[FULL]` chỉ khi bước sau cần tra cứu chi tiết

## Danh sách prompt

| # | File | Nhiệm vụ | Cần từ bước trước |
|---|------|----------|-------------------|
| 1 | `01_parse_lc.md` | Phân tích L/C → JSON | File L/C |
| 2 | `02_extract_docs.md` | Trích xuất dữ liệu chứng từ → JSON | File chứng từ + [COMPACT-1] |
| 3 | `03_normalize_facts.md` | Chuẩn hóa & xác định sự thật → JSON | [COMPACT-1] + [COMPACT-2] |
| 4 | `04_evaluate.md` | Đánh giá lỗi → JSON | [COMPACT-1,2,3] + [FULL-1] khi cần tra L/C |
| 5 | `05_self_audit.md` | Kiểm tra kép → JSON | [COMPACT-4] + [FULL-1] khi cần |
| 6 | `06_report.md` | Xuất báo cáo markdown | [COMPACT-3,5] |

## Ước tính token tại mỗi bước (same session)

| Bước | Prompt | History (compact) | File context | Tổng ước tính |
|------|--------|-------------------|-------------|---------------|
| 1 | ~1K | 0 | ~3K (L/C) | ~4K |
| 2 | ~2K | ~0.5K | ~8K (chứng từ) | ~10K |
| 3 | ~1K | ~1K | 0 | ~2K |
| 4 | ~2K | ~1.5K | 0 (tra [FULL-1] nếu cần) | ~4-7K |
| 5 | ~1K | ~2K | 0 | ~3K |
| 6 | ~1K | ~1K | 0 | ~2K |

Peak: ~10K tại Prompt 2 (do file chứng từ). Rất thoải mái cho mọi model.
