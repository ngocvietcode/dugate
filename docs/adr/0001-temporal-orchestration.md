# ADR-0001: Dùng Temporal làm orchestration engine

- **Trạng thái**: Proposed
- **Ngày**: 2026-10-25
- **Liên quan**: [ARCHITECTURE_V5](../enterprise/ARCHITECTURE_V5.md)
- **Điều chỉnh phạm vi bởi**: [ADR-0002](0002-core-apps-layering.md) — Temporal chỉ dùng ở tầng Apps; pipeline cấu hình của Core giữ mô hình Operation hiện tại

## Bối cảnh

Workflow nghiệp vụ (giải ngân, kiểm tra L/C, so sánh văn bản) đang chạy trên engine tự viết dựa trên BullMQ (`lib/pipelines/workflow-engine.ts`):
- sub-step chờ bằng `job.waitUntilFinished()` trong khi parent giữ slot worker;
- checkpoint/resume thủ công qua `Operation.currentStep` + `stepsResultJson`, mỗi workflow tự viết logic restore;
- HITL bằng trạng thái `WAITING_USER_INPUT` và enqueue lại job.

Khi đưa vào ngân hàng, yêu cầu: không mất/lặp hồ sơ, chờ duyệt nhiều ngày, maker-checker, audit đầy đủ, triển khai on-prem, và dễ để AI agent viết thêm workflow mà không phá vỡ hệ thống.

## Quyết định

Dùng **Temporal (self-hosted, persistence PostgreSQL) + TypeScript SDK** cho mọi orchestration (workflow code-driven và pipeline cấu hình từ UI).

- Workflow = code deterministic trong `packages/workflows` (hoặc `lib/temporal/workflows` trước khi tách package).
- Mọi side effect (HTTP connector, DB, storage, webhook, audit) là activity, phải idempotent.
- HITL dùng Update có validator; chờ bằng `condition()` có timeout.
- Payload mã hóa bằng Payload Codec; tài liệu truyền bằng tham chiếu (claim-check).
- Thay đổi workflow phải qua replay test; thay đổi không tương thích dùng `patched()` hoặc worker versioning.
- `Operation` giữ làm projection để không đổi API `/api/v1` (AIP-151).

## Hệ quả

**Tích cực**: xóa được checkpoint/resume/stalled-recovery tự viết; HITL và retry trở thành khai báo; event history là audit kỹ thuật; workflow test được với time-skipping → vòng phản hồi nhanh cho agent.

**Tiêu cực**: thêm Temporal cluster phải vận hành (HA, backup, nâng cấp); đội phải tuân thủ luật determinism; giai đoạn chuyển tiếp có 2 engine song song.

## Phương án khác

Giữ BullMQ (vá dần), Camunda 8, Restate/Inngest, Step Functions — so sánh ở ARCHITECTURE_V5 §8.
