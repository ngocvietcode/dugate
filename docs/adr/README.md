# Architecture Decision Records

Mỗi quyết định kiến trúc có ảnh hưởng lâu dài → 1 file `NNNN-<slug>.md`. Agent và người **không** thay đổi điều đã có ADR `Accepted` mà không tạo ADR mới thay thế (`Superseded by`).

Template:

```markdown
# ADR-NNNN: <Tiêu đề>

- **Trạng thái**: Proposed | Accepted | Superseded by ADR-XXXX
- **Ngày**: YYYY-MM-DD

## Bối cảnh
## Quyết định
## Hệ quả
## Phương án khác
```

| ADR | Tiêu đề | Trạng thái |
|---|---|---|
| [0001](0001-temporal-orchestration.md) | Dùng Temporal làm orchestration engine (phạm vi: tầng Apps — xem 0002) | Proposed |
| [0002](0002-core-apps-layering.md) | Tách Core và Apps; Apps cung cấp workflow như service | Proposed |
