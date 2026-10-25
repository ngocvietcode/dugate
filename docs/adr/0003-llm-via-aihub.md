# ADR-0003: Mọi lời gọi LLM đi qua VPBank AIHub bằng connector

- **Trạng thái**: Proposed
- **Ngày**: 2026-10-25
- **Liên quan**: [AIHUB_INTEGRATION](../enterprise/AIHUB_INTEGRATION.md), ADR-0002

## Bối cảnh
VPBank đã có AIHub là nền tảng LLM nội bộ (host/định tuyến model, guardrail, metering). Core hiện gọi AI qua `ExternalApiConnection` (multipart, API key/Bearer) và còn một điểm gọi SDK Gemini/OpenAI trực tiếp.

## Quyết định
1. Ở môi trường ngân hàng, **mọi lời gọi LLM của dugate đi qua AIHub**, cấu hình là `ExternalApiConnection` của Core. Apps không gọi AIHub trực tiếp (giữ luật L2).
2. dugate không gọi trực tiếp nhà cung cấp LLM bên ngoài; egress Internet của dugate bị chặn; điểm gọi SDK trực tiếp bị tắt.
3. dugate không làm lại năng lực AIHub đã có (model routing, guardrail mức model, chargeback).
4. Core mở rộng connector cho chuẩn tích hợp của AIHub: body JSON (C7), OAuth2/mTLS (C8), đọc model + request id từ response (C9), đơn giá theo connector (C10).

## Hệ quả
- Chính sách dữ liệu ra LLM bên ngoài (D2) do AIHub quản trị; dugate chỉ gắn nhãn phân loại dữ liệu nếu AIHub yêu cầu.
- Phụ thuộc SLA/quota của AIHub → Apps cấu hình concurrency và timeout theo đó.
- Nếu AIHub không có OCR/vision, cần thêm engine OCR riêng làm connector cho `ingest`.
