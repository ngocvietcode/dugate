# Loan Application Context (LAC) trong kiến trúc dugate Core + Apps

| Mục | Giá trị |
|---|---|
| Trạng thái | DRAFT — chờ quyết định §9 |
| Nguồn | Tài liệu "Loan Application Context" và "Quy tắc giá trị chuẩn, phân loại sai lệch và kiểm tra LAC" (Bùi Ngọc Việt, 24/10/2026); PoC `build_case_graph.py`, `validate_case.py`, `draw_case_graph.py` (Python + NetworkX) |
| Liên quan | [LAYERED_ARCHITECTURE](LAYERED_ARCHITECTURE.md), [AIHUB_INTEGRATION](AIHUB_INTEGRATION.md), [spec 002](../../specs/002-credit-appraisal-assist/spec.md) |

> **Dữ liệu**: PoC đã chạy trên một hồ sơ thật. Hồ sơ đó, `facts.json`, `graph.json`, `discrepancies.*`, `branch2_context.md`, `case_graph.png` **không được commit** vào repo (constitution §1–2). Test và tài liệu chỉ dùng fixture giả lập.

---

## 1. LAC là gì (tóm tắt)

LAC là một **lớp tất định** đặt giữa trích xuất (DU) và thẩm định. Nó biến dữ liệu lưu theo từng chứng từ thành một bản hồ sơ chuẩn hoá, trả lời bốn câu hỏi: ai là ai, ai liên quan đến ai, giá trị nào đúng và lấy từ đâu, chỗ nào không khớp.

- **Giai đoạn 1 · Consistency**: mỗi mục checklist phải đúng loại, **đúng người**, còn hiệu lực; chưa đủ thì trả RM trước khi tốn chi phí.
- **Giai đoạn 2 · Integrity**: dựng graph (gán người bằng điểm bằng chứng), chọn giá trị chuẩn (chuẩn hoá → hiệu lực thời gian → thẩm quyền → đa số nguồn độc lập), phát hiện sai lệch, phân loại **N / A / B / C**, xếp mức **S1–S4**, tín hiệu chéo vùng **T#**, chỉ số tính sẵn.
- **Hai nhánh song song**: nhánh 1 soát dữ liệu (mọi sai lệch); nhánh 2 thẩm định bằng AI trên bản trích (giá trị chuẩn + mâu thuẫn C + T# + giới hạn dữ liệu), mỗi kết luận trích F#/X#/T#.
- **Bước ghép bằng code**: `đủ điều kiện trình` / `tạm thời kèm điều kiện` / `chờ bổ sung`; chạy lại một phần khi nhánh 1 đổi phân loại.

Kết quả PoC trên một hồ sơ hộ kinh doanh: dữ liệu đưa vào AI thẩm định giảm ~83% (~15.000 → ~2.600 token), phát hiện thêm 5 vấn đề (nặng nhất: CIC không phải của người vay), loại 2 cảnh báo nhầm. Cần đo trên 50–100 hồ sơ.

LAC **khớp hoàn toàn** với nguyên tắc đã chốt: AI đọc và viết, code tính và kết luận (spec 002 §4); App không ra quyết định (ADR-0002).

---

## 2. LAC nằm ở tầng nào

| Thành phần LAC | Tầng | Lý do |
|---|---|---|
| Tách trang, phân loại, trích xuất trường (kèm `status`, `candidates`) | **Core** (qua AIHub) | Năng lực đọc tài liệu chung, không mang nghiệp vụ |
| Bổ sung DU: trang, bbox, độ tin cậy theo trường; họ tên trong mọi bản ghi; chủ thể trên thẻ chứng từ | **Core** | Năng lực chung — mở rộng C6 (§6) |
| Đọc lại một vùng ảnh khi nhánh 1 cần xác nhận | **Core** (endpoint mới, vd. `extract:region`) | Chung cho mọi App |
| Graph hồ sơ, gán người, giá trị chuẩn, phân loại sai lệch, mức độ, T#, chỉ số | **Apps — gói dùng chung `credit-kit/lac`** | Mang khái niệm tín dụng (CIC, GCN, khoản vay) → không thuộc Core (constitution L3); dùng chung cho nhiều App |
| Giai đoạn 1 (cổng đủ hồ sơ), hai nhánh, bước ghép | **App `credit-appraisal-assist`** | Orchestration nghiệp vụ |
| Quyết định | **LOS** | ADR-0002 |

Vì LAC được nhiều quy trình dùng lại (tài liệu LAC §7.1: soạn tờ trình, giải ngân), nó là **thư viện miền tín dụng trong tầng Apps**, không phải một App:

```
apps/
  credit-kit/
    lac/                 # dựng graph + quy tắc (từ PoC)
    config/              # bảng thẩm quyền, nhóm nguồn, K1–K3, tham số — có version
  credit-appraisal-assist/   # App: GĐ1 → GĐ2 → 2 nhánh → ghép
  disbursement-check/        # App sau này, dùng lại credit-kit/lac
```

---

## 3. Luồng App trên Temporal

```
LOS ─start(context, documents)─▶ credit-appraisal-assist
  [1] Core: tách trang, phân loại, lập thẻ chứng từ            (activity → Core → AIHub)
  [2] GĐ1 cổng đủ hồ sơ: đúng loại / đúng người / còn hiệu lực   (activity lac.phase1, tất định)
        └─ thiếu / sai người / hết hiệu lực → kết thúc sớm: outcome PENDING_SUPPLEMENT + danh sách cho RM
  [3] Core: trích xuất đầy đủ các trường                        (activity → Core → AIHub)
  [4] Dựng LAC + validate                                        (activity lac.build_validate, tất định)
        → facts (F#), discrepancies (X#), signals (T#), metrics, branch2 extract
  ┌─[5a] Nhánh 1 · soát dữ liệu (HITL)                          ┌─[5b] Nhánh 2 · thẩm định AI
  │   ReviewTask theo nhóm X# (S1/S2 trước)                     │   Core generate (AIHub) với bản trích LAC
  │   đọc lại vùng ảnh (Core extract:region)                    │   output: [{id:K#, text, fields, conflicts, signals}]
  │   CVTĐ xác nhận / đổi phân loại / sửa lỗi A                 │   code kiểm: mọi F#/X#/T# trích dẫn tồn tại;
  │   → Update `reclassify` vào workflow                        │   số trong text khớp facts/metrics (narrative guard)
  └────────────┬───────────────────────────────────────────────┘
  [6] Bước ghép (code, trong workflow): trạng thái hồ sơ + gắn "tạm thời"
      khi nhánh 1 đổi phân loại hoặc giá trị → chạy lại [4] cho phần bị ảnh hưởng
      → chỉ chạy lại các K# trích F# bị ảnh hưởng
  [7] (tùy chọn) Dự thảo tờ trình từ LAC + K#                    (spec 002 FR-15..19)
LOS ◀─run.completed── status + K# + X# + T# + metrics + lac.json ref
```

Vì sao Temporal phù hợp: nhánh 1 có thể kéo dài nhiều ngày; bước ghép phải phản ứng với từng lần xác nhận (Update) và chạy lại **một phần** (chỉ các K# trích F# đã đổi) — đúng loại orchestration có trạng thái, bền vững mà engine BullMQ hiện tại phải tự làm bằng `currentStep`.

Ánh xạ trạng thái ghép sang Workflow Service Contract (thay `outcome` của spec 002 FR-20):

| LAC (bước ghép) | `outcome` |
|---|---|
| Còn S1 chưa xử lý | `PENDING_SUPPLEMENT` |
| Có K# trích F# đang vướng S2 | `PROVISIONAL` (kèm điều kiện cần xác minh) |
| Không còn S1, không K# vướng S2 | `ELIGIBLE_TO_SUBMIT` |

Cả ba đều là trạng thái hồ sơ, **không** phải đề xuất cho vay/từ chối.

---

## 4. Python (NetworkX) hay TypeScript

Temporal cho phép **worker đa ngôn ngữ**: workflow viết TypeScript, activity LAC chạy trong **worker Python** trên task queue riêng (`credit-lac-py`), cùng namespace.

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Giữ Python, worker Temporal Python (đề xuất cho giai đoạn thử nghiệm)** | Dùng lại nguyên PoC đã kiểm chứng; NetworkX; người viết quy tắc tiếp tục làm việc trên Python; chạy 50–100 hồ sơ ngay | Hai ngôn ngữ trong repo; cần contract `lac.json` chặt (JSON Schema → Zod + Pydantic) |
| B. Port sang TypeScript | Một ngôn ngữ; dùng chung type với App | Viết lại ~2.000 dòng quy tắc trước khi có số đo; graph lib TS (graphology) kém phổ biến hơn |

Đề xuất: **A** cho tới khi có số đo trên 50–100 hồ sơ và bộ quy tắc ổn định; xem lại B sau đó (ADR riêng). Ranh giới không đổi: Python worker là activity của tầng Apps, chỉ nhận JSON từ Core và trả `lac.json`; không gọi Core/AIHub/DB trực tiếp.

---

## 5. Từ PoC lên production

| # | Việc | Nguồn |
|---|---|---|
| P1 | Tách hằng số cấu hình khỏi code (`SOURCE_GROUP`, `TIERS`, `TEMPORAL`, `STALE_DAYS`, `PROVINCE_CODES`, `ABBREV`, `FIN_TOLERANCE`, `SEV_BASE`…) ra file cấu hình có version, maker-checker | `validate_case.py`; Quy tắc §8 |
| P2 | Chốt contract `lac.json` (Quy tắc LAC §8.2) thành JSON Schema có version; đầu vào là contract đầu ra DU của Core | LAC §8.2 |
| P3 | Adapter đầu vào: PoC đọc schema `dugate.loan-appraisal.integration 5.0` (không có trong repo này) → xác định nơi sinh và đưa vào contract Core | `build_case_graph.py` docstring |
| P4 | Test: mỗi quy tắc R-* có bảng case trên fixture giả lập; snapshot test `lac.json` cho 3–5 hồ sơ giả lập | PoC chưa có test |
| P5 | Code hoá kiểm tra chéo vùng (R-X-*) và lớp chỉ số | Quy tắc §7, "việc cần làm" |
| P6 | Vùng Phương án vốn và Tài chính có kỳ + loại nguồn | Quy tắc §9 |
| P7 | Từ điển viết tắt, bảng địa danh sau sáp nhập 2025 đầy đủ (kiểm tra giấy phép dữ liệu) | Quy tắc §9 |
| P8 | Schema đầu ra nhánh 2 + kiểm tra trích dẫn + narrative guard | LAC §5 bước 2.6 |
| P9 | Bước ghép + chạy lại một phần | Quy tắc §9 |
| P10 | Màn hình nhánh 1 (theo X#, hiện vùng ảnh) | phụ thuộc bbox từ DU |
| P11 | Đo trên 50–100 hồ sơ theo LAC §7.2, môi trường được phép xử lý dữ liệu thật | LAC §7.2 |

---

## 6. Bổ sung cho Core (nối vào danh sách C1–C10)

| # | Bổ sung | Ghi chú |
|---|---|---|
| C6 (mở rộng) | Mỗi trường trích xuất trả `page`, `bbox`, `confidence`, `status` (`AGREED` / `SINGLE_SOURCE` / `CONFLICT`) và `candidates` | DU hiện đã trả `status`/`candidates` theo tài liệu LAC; thiếu trang/bbox/độ tin cậy |
| C11 | Họ tên người trong mọi bản ghi `parties[]`; chủ thể (định danh, số cũ, địa chỉ) trên thẻ chứng từ | Cần cho gán người và điều kiện "đúng người" của GĐ1 |
| C12 | Endpoint đọc lại vùng ảnh (`documentId`, `page`, `bbox`, câu hỏi) | Nhánh 1 tách A với B |
| C4 | Document handle | Không tải/OCR lại giữa bước [1], [3], đọc lại vùng |

---

## 7. Mở rộng LAC cho SME doanh nghiệp

PoC là **vay hộ kinh doanh có TSBĐ**. Tài liệu LAC §3.4 đã định hướng một schema cho mọi sản phẩm; với doanh nghiệp SME, graph bổ sung:

| Bổ sung | Node / cạnh | Quy tắc ví dụ |
|---|---|---|
| Pháp nhân | `C#` doanh nghiệp (thay `B#` hộ kinh doanh) | Tên, MST, địa chỉ khớp giữa ĐKDN, BCTC, nghị quyết, hợp đồng |
| Cơ cấu sở hữu & đại diện | `P# -OWNS_SHARE{tỷ lệ}-> C#`, `P# -LEGAL_REP-> C#`, `P# -SIGNS{chức danh}-> D#` | Người ký nghị quyết/hợp đồng đúng thẩm quyền theo điều lệ; đủ tỷ lệ biểu quyết |
| Quyết định nội bộ | `D#(resolution) -APPROVES{số tiền, mục đích, TSBĐ}-> L#` | Nghị quyết chấp thuận số tiền ≥ số vay, đúng mục đích, còn hiệu lực |
| Tài chính theo kỳ | `C# -REPORTS-> FS#{năm, loại: kiểm toán/thuế/tự lập}` | TS = NV; số đầu kỳ N = cuối kỳ N-1; doanh thu BCTC so tờ khai thuế (spec 002 CON-1..CON-4 trở thành quy tắc R-FIN-*) |
| Bên liên quan | `C# -RELATED{loại}-> C#` (công ty mẹ/con, cùng chủ) | Dư nợ nhóm khách hàng liên quan **chỉ khi LOS cung cấp qua `context`** (L6) |
| Bảo lãnh | `P#/C# -GUARANTEES{phạm vi}-> L#` | Bên bảo lãnh có giấy tờ nhân thân/pháp lý, CIC riêng |

Bảng thẩm quyền (Quy tắc §3.4), độ trọng yếu K1–K3 và checklist thêm nhóm "Pháp nhân" và "Tài chính doanh nghiệp" theo cấu hình sản phẩm. Graph trong một hồ sơ SME vẫn nhỏ (vài chục đến vài trăm node), NetworkX đủ; graph liên hồ sơ (Neo4j) vẫn là giai đoạn sau.

---

## 8. Ảnh hưởng tới spec 002

| Spec 002 hiện tại | Điều chỉnh |
|---|---|
| Phạm vi v1: SME doanh nghiệp, BCTC | Đề xuất: v1 = **HKD có TSBĐ (PP-HKD-SECURED)** — đã có PoC, quy tắc và hồ sơ thử; SME doanh nghiệp = v2 bằng cấu hình (§7) |
| Bước [D] trích xuất → [E] chuẩn hoá → [G] CON-* → [H] FIN-* → [I] chính sách | Thay bằng **LAC**: GĐ1 + GĐ2 + R-*, R-X-*, lớp chỉ số |
| Một điểm soát `REVIEW_EXTRACTION` theo trường | Nhánh 1 soát **theo sai lệch X#**, ưu tiên S1/S2; N tự đóng |
| `outcome` `NO_EXCEPTIONS` / `EXCEPTIONS_FOUND` / `INCOMPLETE` | `ELIGIBLE_TO_SUBMIT` / `PROVISIONAL` / `PENDING_SUPPLEMENT` (§3) |
| `findings[].evidence` | F# (nguồn D#) + X# + T#; bbox khi Core có C6 |
| Dự thảo tờ trình | Giữ; đầu vào là LAC + K# |
| RuleSet chính sách có version | Gộp với cấu hình LAC (P1) |

Spec 002 sẽ được viết lại theo bảng trên sau khi chốt §9.

---

## 9. Quyết định cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| LAC-1 | Phạm vi v1 của App: HKD có TSBĐ (có PoC) hay SME doanh nghiệp (BCTC)? | HKD v1, SME v2 |
| LAC-2 | Giữ Python + NetworkX làm worker Temporal hay port sang TypeScript? | Giữ Python tới khi có số đo |
| LAC-3 | Đầu ra DU `dugate.loan-appraisal.integration 5.0` đang được sinh ở đâu? Có thuộc Core không? | Cần thông tin |
| LAC-4 | Môi trường nào được phép chạy 50–100 hồ sơ thật để đo? | UAT nội bộ VPBank, có phê duyệt dữ liệu |
