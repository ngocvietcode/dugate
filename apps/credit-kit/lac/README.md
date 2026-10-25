# credit-kit/lac — Loan Application Context

Lớp tất định dựng **Loan Application Context** cho hồ sơ vay: graph thực thể (NetworkX `MultiDiGraph`), gán người bằng điểm bằng chứng, chọn giá trị chuẩn, phát hiện và phân loại sai lệch (N/A/B/C, S1–S4), xuất bản trích cho nhánh thẩm định.

- Thiết kế: [docs/enterprise/LAC_INTEGRATION.md](../../../docs/enterprise/LAC_INTEGRATION.md)
- Quy tắc gốc: [docs/credit/lac-rules.md](../../../docs/credit/lac-rules.md)
- Spec/tasks: [specs/002-credit-appraisal-assist](../../../specs/002-credit-appraisal-assist/)

Trạng thái: PoC đã đưa vào repo (L1), có fixture giả lập + snapshot + test tất định (L2–L3), cấu hình tách ra `apps/credit-kit/config/<sản phẩm>/<version>/` (L4).

## Cài đặt

```bash
cd apps/credit-kit/lac
python -m venv .venv && . .venv/bin/activate
pip install -e '.[draw,dev]'
```

## Dùng

Đầu vào: JSON hồ sơ theo schema `dugate.loan-appraisal.integration` 5.0 (đầu ra DU).

```bash
python -m lac.graph    case.json -o out/              # graph.json + llm_context.md
python -m lac.validate case.json -o out/ --ref-date 2026-10-23 --cic-max-age 30
                                                      # facts.json, discrepancies.json/.md, branch2_context.md
python -m lac.draw     out/graph.json -o out/graph.png   # cần extra [draw]
```

Hồ sơ thật đặt trong `cases/`, kết quả trong `out/` — cả hai đã bị `.gitignore`. Không commit hồ sơ thật hay kết quả chạy trên hồ sơ thật.

| Module | Nguồn PoC |
|---|---|
| `lac/graph.py` | `build_case_graph.py` |
| `lac/validate.py` | `validate_case.py` |
| `lac/draw.py` | `draw_case_graph.py` |
