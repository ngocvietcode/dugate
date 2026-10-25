# Tasks 002 v2: `credit-appraisal-assist` (HKD có TSBĐ, lõi LAC)

> `/implement` lấy task đầu tiên chưa tick mà phụ thuộc đã xong. Phase L bắt đầu được ngay (không cần Q1–Q5, LAC-3 chỉ chặn L7). Phase A độc lập với Phase L.
> Mỗi task: một phiên agent, có lệnh kiểm chứng. Không đưa dữ liệu hồ sơ thật vào repo.

## Phase L — `credit-kit/lac` (Python)

- [x] **L1 — Đưa PoC vào repo nguyên trạng + chạy được**
  - File: `apps/credit-kit/lac/{pyproject.toml,README.md,CLAUDE.md}`, `lac/graph.py`, `lac/validate.py`, `lac/draw.py` (copy PoC, chỉ đổi import), `.gitignore` (`cases/`, `out/`)
  - Kiểm chứng: `python -m lac.validate <fixture> -o /tmp/out` chạy không lỗi; output gồm `facts.json`, `discrepancies.json`, `branch2_context.md`

- [x] **L2 — Fixture giả lập**
  - File: `tests/fixtures/make_synthetic.py`, `tests/fixtures/hkd_*.json` (≥ 5 hồ sơ: CIC sai chủ thể, thu nhập ×12, địa chỉ 4 cách viết, giấy tờ cũ/mới, tự khai lệch bậc 1, thiếu chữ ký, LTV sát trần)
  - Phụ thuộc: L1
  - Kiểm chứng: script sinh lại fixture giống hệt; grep không có số định danh/SĐT có thật (danh sách chặn)

- [x] **L3 — Snapshot + test tất định (khoá hành vi PoC)**
  - File: `tests/test_snapshot.py`, `tests/test_determinism.py`, `tests/snapshots/`
  - Phụ thuộc: L2
  - Kiểm chứng: `pytest` xanh; chạy 2 lần cho output byte-identical (AC-7)

- [x] **L4 — Tách cấu hình khỏi code**
  - File: `apps/credit-kit/config/pp-hkd-secured/0.1.0/*.yaml`, `lac/config.py` (loader + schema), sửa `graph.py`/`validate.py` đọc từ config
  - Phụ thuộc: L3
  - Kiểm chứng: snapshot L3 không đổi; đổi `params.yaml` cic_max_age 30→120 làm mất X# R-CIC-AGE trên fixture tương ứng

- [x] **L5 — Test theo quy tắc R-***
  - File: `tests/test_rules_*.py` (mỗi R-* ≥ 1 case dương, 1 case âm), AC-2..AC-5
  - Phụ thuộc: L4
  - Kiểm chứng: `pytest -k rules` xanh; coverage `validate.py` ≥ 80%

- [x] **L6 — Contract `lac.json`**
  - File: `apps/credit-kit/contracts/lac.schema.json`, `lac/export.py` (gộp facts/discrepancies/graph/branch2 thành `lac.json`), kiểm bằng `jsonschema`
  - Phụ thuộc: L5
  - Kiểm chứng: output mọi fixture validate theo schema; FR-14

- [x] **L7 — Adapter đầu vào DU** (adapter DU v5 xong; adapter Core chờ LAC-3)
  - File: `lac/adapters/du_integration_v5.py` (+ adapter Core khi chốt)
  - Phụ thuộc: L6
  - Kiểm chứng: fixture DU v5 → input LAC → snapshot không đổi

- [ ] **L8 — Giai đoạn 1 (cổng đủ hồ sơ)**
  - File: `lac/phase1.py`, `config/.../checklist.yaml`, tests (AC-1)
  - Phụ thuộc: L6 (Q2 cho checklist thật)
  - Kiểm chứng: fixture CIC của vợ/chồng → mục CIC `THIẾU` với "cần CIC của người vay"

- [ ] **L9 — Tín hiệu chéo vùng R-X-* + lớp chỉ số**
  - File: `lac/signals.py`, `lac/metrics.py`, tests theo bảng tính đối chứng (AC-6)
  - Phụ thuộc: L6
  - Kiểm chứng: T# và chỉ số khớp đối chứng; DSCR thiếu lãi suất → "chưa tính được"

- [ ] **L10 — Vùng Phương án vốn và Tài chính có kỳ + loại nguồn**
  - File: `graph.py`, `validate.py`, schema, tests
  - Phụ thuộc: L9
  - Kiểm chứng: R-CROSS-DOC, R-ARITH chạy trên vùng mới; snapshot cập nhật có review

- [ ] **L11 — Script đo trên hồ sơ thật (ngoài repo)**
  - File: `apps/credit-kit/lac/scripts/measure.py` (đọc thư mục ngoài repo, xuất bảng LAC §7.2, không ghi dữ liệu người ra log)
  - Phụ thuộc: L7, L8, L9
  - Kiểm chứng: chạy trên fixture → bảng chỉ số; chạy thật ở môi trường LAC-4

- [ ] **L12 — Worker Temporal Python**
  - File: `lac/worker.py` (activities `phase1_gate`, `build_validate`, `rebuild`; task queue `credit-lac-py`; payload codec)
  - Phụ thuộc: A1, L8, L9
  - Kiểm chứng: test với Temporal test server; AC-12

## Phase A — Khung Apps (TS)

Giữ nguyên **T-A1 … T-A8** của bản trước (workspace + Temporal dev, lint ranh giới, contract, DB `apps`, `core-client` + `callCore`, projection/audit/webhook, workflow-kit review + maker-checker, server + worker). Bổ sung:

- [ ] **A9 — Sinh Zod từ `lac.schema.json` + kiểm khớp trong CI**
  - Phụ thuộc: L6, T-A3
  - Kiểm chứng: đổi schema mà không sinh lại → CI fail

## Phase B — App

- [ ] **B1 — Schema context/output, app.yaml** (FR-1..FR-3)
- [ ] **B2 — Workflow: GĐ1 → trích xuất → LAC** (gọi Core + activity Python; STRICT/TRIAL) — phụ thuộc L12, T-A5
- [ ] **B3 — Nhánh 2: prompt ref + gọi Core + verify trích dẫn & con số** (FR-20..FR-23, AC-8) — phụ thuộc Core C2/C7–C9 hoặc mock
- [ ] **B4 — Bước ghép + chạy lại một phần** (FR-24..FR-26, AC-9, AC-10) — hàm thuần + workflow test
- [ ] **B5 — Nhánh 1: ReviewTask theo X#, hành động, Update `reclassify`** (FR-15..FR-19, AC-11) — phụ thuộc T-A7
- [ ] **B6 — Màn hình nhánh 1** — phụ thuộc Q1, Core C6/C12
- [ ] **B7 — E2E với mock-service + fixture giả lập** (AC-1..AC-12)
