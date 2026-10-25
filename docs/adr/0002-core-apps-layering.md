# ADR-0002: Tách dugate Core và dugate Apps; Apps cung cấp workflow như service

- **Trạng thái**: Proposed
- **Ngày**: 2026-10-25
- **Liên quan**: [LAYERED_ARCHITECTURE](../enterprise/LAYERED_ARCHITECTURE.md), điều chỉnh phạm vi [ADR-0001](0001-temporal-orchestration.md)

## Bối cảnh
Workflow nghiệp vụ (giải ngân, L/C, so sánh văn bản) đang nằm trong Core (`lib/pipelines/workflows/*`), gọi connector trực tiếp và mang prompt nghiệp vụ trong code. Ngân hàng đã có LOS, Trade Finance, BPM, ECM, core banking — giải pháp không được chồng lấn hay thay thế các hệ thống đó.

## Quyết định
1. **Core** = Document Understanding Gateway trung lập nghiệp vụ: endpoint nguyên tử, connector, profile, prompt template, chi phí, audit lời gọi AI.
2. **Apps** = lớp mới; mỗi App là một workflow nghiệp vụ đóng gói thành service theo một *Workflow Service Contract* chung; là một *service task* trong quy trình của hệ thống ngân hàng.
3. Phụ thuộc một chiều: hệ thống ngân hàng → Apps → Core → engines. Apps chỉ dùng API công khai của Core với ApiKey role `APP`.
4. Apps trả **khuyến nghị kèm bằng chứng**; không sở hữu master data, không ra quyết định, không hạch toán, không quản lý hàng đợi việc toàn ngân hàng.
5. Temporal (ADR-0001) chỉ dùng ở tầng Apps; Core giữ mô hình Operation hiện tại.

## Hệ quả
- Core cần bổ sung năng lực chung: prompt template có version + `prompt_ref`, role `APP`, document handle, chuẩn hóa evidence, expose các connector đang chỉ dùng nội bộ.
- Workflow hiện có chuyển dần thành App; code workflow trong Core bị gỡ khi App thay thế.
- Tích hợp với ngân hàng làm một lần (contract chung) cho mọi App.
- Thêm một bước gọi mạng Apps → Core (độ trễ nhỏ so với thời gian gọi AI).
