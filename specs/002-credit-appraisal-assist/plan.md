# Plan 002 v2: `credit-appraisal-assist` (HKD có TSBĐ, lõi LAC)

## Cách tiếp cận

Ba phase:
- **Phase A — Khung Apps** (dùng chung mọi App): như bản trước — Temporal dev, `apps/` workspace, contract, `core-client`, projection, audit, review task, webhook, lint ranh giới.
- **Phase L — `credit-kit/lac` (Python)**: đưa PoC vào repo thành package Python có test, cấu hình tách khỏi code, contract `lac.json`, worker Temporal Python.
- **Phase B — App**: workflow TypeScript, GĐ1, hai nhánh, bước ghép, màn hình nhánh 1.

### Quyết định kỹ thuật
| # | Quyết định | Lý do |
|---|---|---|
| P1 | `apps/` là npm workspace (TS) + `apps/credit-kit/lac/` là package Python (`pyproject.toml`, `uv` hoặc `pip`); cùng repo (L1) | LAC-2 |
| P2 | Workflow TS gọi activity Python qua task queue `credit-lac-py`: `phase1_gate(input) -> Phase1Result`, `build_validate(input) -> Lac`, `rebuild(lac, changes) -> Lac` | Temporal đa ngôn ngữ |
| P3 | Contract: `apps/credit-kit/contracts/lac.schema.json` (JSON Schema 2020-12, version 1.0) là nguồn sự thật. Python kiểm output bằng `jsonschema` trong test (không sinh Pydantic — output do code tự dựng, kiểm schema là đủ); TS sinh Zod từ schema (A9), CI kiểm bản sinh khớp | Hai ngôn ngữ, một contract |
| P4 | Payload Temporal: `lac.json` có thể vài chục KB → vẫn dưới giới hạn; mã hoá bằng Payload Codec chung (Python codec tương đương TS, cùng khoá) | Constitution §6 |
| P5 | Cấu hình LAC dạng YAML có version trong `apps/credit-kit/config/<product>/<version>/`; loader kiểm schema; giá trị tạm đánh dấu `provisional: true` | FR-27 |
| P6 | Giữ cấu trúc code PoC khi đưa vào (`graph.py` ← `build_case_graph.py`, `validate.py` ← `validate_case.py`, `draw.py` ← `draw_case_graph.py`); chỉ tách hằng số ra cấu hình và thêm test — **không refactor logic** trong phase L | Bảo toàn hành vi đã kiểm chứng |
| P7 | Adapter đầu vào: `adapters/du_integration_v5.py` chuyển đầu ra DU hiện tại → input LAC; adapter Core contract viết sau khi chốt LAC-3 | LAC-3 |
| P8 | Nhánh 2 và kiểm trích dẫn/narrative guard viết TS trong App (gọi Core); bước ghép là hàm thuần TS trong workflow | Ghép phải deterministic, replay được |
| P9 | Fixture: script `apps/credit-kit/lac/tests/fixtures/make_synthetic.py` sinh hồ sơ giả lập theo schema DU v5 với các tình huống của AC-1..AC-6; không có dữ liệu thật trong repo; `.gitignore` chặn thư mục `cases/` | NFR-6 |

## Cấu trúc

```
apps/
  credit-kit/
    contracts/lac.schema.json
    config/pp-hkd-secured/0.1.0/{authority.yaml,source_groups.yaml,temporal.yaml,criticality.yaml,params.yaml,checklist.yaml,provinces.yaml,abbrev.yaml}
    lac/
      pyproject.toml  README.md  CLAUDE.md
      lac/{graph.py,validate.py,draw.py,config.py,adapters/du_integration_v5.py,phase1.py,signals.py,metrics.py,worker.py}
      tests/{fixtures/,test_rules_*.py,test_determinism.py,test_snapshot.py}
  credit-appraisal-assist/
    app.yaml  README.md  schema.ts  workflow.ts  merge.ts  branch2/{prompt-ref.ts,verify.ts}  workflow.test.ts  histories/
```

## Kiểm thử
- **Python**: pytest theo từng quy tắc R-*, R-X-*, chỉ số; snapshot `lac.json` cho mỗi fixture; test tất định (chạy 2 lần so byte).
- **Contract**: JSON Schema validate output Python; Zod parse cùng output trong test TS.
- **Workflow TS**: time-skipping test với activity Python và Core mock (TS stub theo contract); test bước ghép (bảng trạng thái AC-9, chạy lại một phần AC-10).
- **Replay**: history mẫu trong `histories/`.
- **Đo thật**: script chạy LAC trên thư mục hồ sơ ngoài repo, xuất bảng chỉ số LAC §7.2 (chạy ở môi trường LAC-4).

## Rollout
- Phase L có giá trị độc lập: chạy batch trên 50–100 hồ sơ để đo **trước** khi có Phase B.
- App bật theo profile caller; tắt App không ảnh hưởng Core.
