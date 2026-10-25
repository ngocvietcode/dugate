# Spec 002: App Hỗ trợ thẩm định — Vay hộ kinh doanh có TSBĐ (`credit-appraisal-assist`)

- **Trạng thái**: Draft v2 — viết lại theo Loan Application Context; chờ trả lời câu hỏi Critical (§9)
- **Tầng**: Apps ([ADR-0002](../../docs/adr/0002-core-apps-layering.md)); orchestration Temporal ([ADR-0001](../../docs/adr/0001-temporal-orchestration.md)); LLM qua AIHub ([ADR-0003](../../docs/adr/0003-llm-via-aihub.md))
- **Lõi nghiệp vụ**: Loan Application Context — [LAC_INTEGRATION](../../docs/enterprise/LAC_INTEGRATION.md), quy tắc gốc [docs/credit/lac-rules.md](../../docs/credit/lac-rules.md)
- **Quyết định đã chốt**: LAC-1 — v1 là **vay hộ kinh doanh có TSBĐ**, SME doanh nghiệp là v2 bằng cấu hình; LAC-2 — lớp LAC **giữ Python + NetworkX**, chạy như worker Temporal Python

## 1. Bối cảnh & vấn đề

Quy trình hiện tại trên DU: tiếp nhận → phân loại & trích xuất → đối chiếu checklist → kiểm tra chính sách (một phần bằng AI đọc toàn bộ ~15.000 token dữ liệu thô) → khuyến nghị. AI tự gom thông tin về từng người, tự chọn giá trị, tự đối chiếu, trả đạt/không đạt mà không chỉ ra căn cứ. Hệ quả trên hồ sơ thử của PoC: báo cáo CIC của người khác vẫn được chấm PASS nhân thân; thu nhập lệch 12 lần không được báo; địa chỉ khác cách viết do sáp nhập bị báo lệch nhầm.

App này đưa **LAC** — lớp tất định dựng hồ sơ chuẩn hoá — vào giữa trích xuất và thẩm định, rồi chạy hai nhánh soát dữ liệu và thẩm định AI song song, ghép bằng code. **Phê duyệt không thuộc App**: chuyên viên tín dụng và cấp có thẩm quyền quyết định trên LOS.

## 2. Phạm vi

### Trong phạm vi (v1)
- Sản phẩm **vay hộ kinh doanh có tài sản bảo đảm là quyền sử dụng đất** (chính sách PP-HKD-SECURED, luồng FAST).
- Giai đoạn 1 · Consistency: cổng đủ hồ sơ với điều kiện **đúng loại, đúng người, còn hiệu lực**.
- Giai đoạn 2 · Integrity: dựng LAC, giá trị chuẩn, sai lệch N/A/B/C, mức S1–S4, tín hiệu chéo vùng T#, chỉ số tính sẵn.
- Nhánh 1 soát dữ liệu (HITL) và nhánh 2 thẩm định AI, chạy song song; bước ghép và chạy lại một phần.
- Kết quả trả LOS: trạng thái hồ sơ, kết luận K# có trích dẫn, sai lệch X#, tín hiệu T#, chỉ số, `lac.json`.

### Ngoài phạm vi
- Quyết định cho vay/từ chối, xếp hạng tín dụng nội bộ chính thức.
- Truy vấn CIC, core banking, hệ thống TSBĐ (L6: chỉ nhận qua `context` hoặc chứng từ).
- Định giá tài sản (App đọc chứng thư/biên bản định giá, không định giá).
- SME doanh nghiệp (v2, cấu hình theo LAC_INTEGRATION §7), vay tiêu dùng, graph liên hồ sơ.
- Dự thảo tờ trình (để spec sau, dùng LAC + K# làm đầu vào).

## 3. Tác nhân

| Tác nhân | Vai trò |
|---|---|
| LOS | Start run, nhận sự kiện, giữ user task và quyết định |
| RM (maker) | Lập hồ sơ; nhận yêu cầu bổ sung khi cổng GĐ1 hoặc sai lệch B chặn |
| Chuyên viên soát dữ liệu / thẩm định (checker) | Xử lý nhánh 1: xác nhận phân loại, đọc lại vùng ảnh, sửa lỗi A; đọc kết quả nhánh 2 |
| Quản lý rủi ro, Sản phẩm, BU, Pháp chế | Sở hữu và duyệt cấu hình có version (lac-rules §8) |
| Kiểm toán nội bộ | Truy vết K# → F#/X# → chứng từ |

## 4. Luồng

Chi tiết ở [LAC_INTEGRATION §3](../../docs/enterprise/LAC_INTEGRATION.md#3-luồng-app-trên-temporal). Tóm tắt:

1. Core tách trang, phân loại, lập thẻ chứng từ.
2. **Cổng GĐ1** (Python LAC): thiếu, sai người hoặc hết hiệu lực → kết thúc sớm, trả RM danh sách cần bổ sung (chế độ chạy thử vẫn chạy tiếp, gắn nhãn "hồ sơ chưa đủ").
3. Core trích xuất đầy đủ trường.
4. **Dựng LAC + validate** (Python LAC).
5. **Nhánh 1** (HITL, theo X#) ∥ **Nhánh 2** (AIHub qua Core, trên bản trích LAC).
6. **Ghép** (code): trạng thái hồ sơ; khi nhánh 1 đổi phân loại hoặc giá trị → dựng lại LAC phần ảnh hưởng, chạy lại K# liên quan.

## 5. Yêu cầu chức năng

### 5.1 Đầu vào
| ID | Yêu cầu |
|---|---|
| FR-1 | `POST /apps/v1/credit-appraisal-assist/runs` theo Workflow Service Contract; idempotent theo `(caller, app, requestId)` |
| FR-2 | `context` bắt buộc: `product` (mã chính sách + version cấu hình), `businessRef` (mã hồ sơ LOS), `referenceDate`. Tùy chọn: `interestRate` dạng số, `assetValuation` (giá trị + ngày + nguồn nếu LOS có), `mode` (`STRICT` \| `TRIAL`) |
| FR-3 | Tài liệu qua `documents[].url` (ECM). Thông tin người, khoản vay, tài sản lấy **từ chứng từ**; App không tự đi lấy (L6) |

### 5.2 Giai đoạn 1 · Consistency
| ID | Yêu cầu |
|---|---|
| FR-4 | Tách và gộp chứng từ: một chứng từ dùng cho nhiều mục checklist chỉ giữ một lần (hash ảnh + hash nội dung) |
| FR-5 | Mỗi mục checklist của sản phẩm nhận `ĐẠT` / `CẦN RÀ SOÁT` / `THIẾU`, xét đủ ba điều kiện đúng loại, đúng người (đối chiếu chủ thể trên thẻ chứng từ với người vay và người liên quan), còn hiệu lực; áp quy tắc chứng từ thay thế |
| FR-6 | `STRICT`: có mục bắt buộc `THIẾU` → không chạy GĐ2, `outcome = PENDING_SUPPLEMENT`, danh sách nêu rõ **chứng từ của ai**. `TRIAL`: chạy tiếp, gắn nhãn |

### 5.3 Giai đoạn 2 · Integrity (Python LAC, tất định)
| ID | Yêu cầu | Quy tắc gốc |
|---|---|---|
| FR-7 | Dựng graph `MultiDiGraph`: node chứng từ, người, hộ kinh doanh, tài sản, khoản vay, phương án vốn, tổ chức tra cứu CIC; cạnh mang chứng từ nguồn và thông tin liên kết | LAC_INTEGRATION §2; lac-rules §3.1 |
| FR-8 | Gán từng lần nhắc người bằng điểm bằng chứng; ngưỡng 2 điểm + hơn ứng viên thứ hai ≥ 2; mức cao ≥ 4; không đạt → người chưa xác định U# | lac-rules §3.1 |
| FR-9 | Chọn giá trị chuẩn: chuẩn hoá → hiệu lực thời gian → bậc thẩm quyền → đa số nguồn độc lập; mỗi thông tin một mã F# kèm nguồn, bậc, quy tắc đã dùng | lac-rules §3.2–3.6 |
| FR-10 | Phát hiện sai lệch theo danh mục R-* (R-CROSS, R-NORM, R-ONEOF, R-INCOME, R-ROLE, R-CROSS-DOC, R-CIC-SUBJECT, R-CIC-AGE, R-DATE, R-ID-FORMAT, R-ID-EXPIRY, R-FORMAT, R-ARITH, R-FORM, R-NAME, R-SOURCE, R-REQUIRED); mỗi X# có loại, độ trọng yếu, mức, trạng thái `chốt theo quy tắc` / `chờ xác nhận` | lac-rules §4–6 |
| FR-11 | Tín hiệu chéo vùng R-X-* (MARITAL-ASSET, LTV-MARGIN, PLAN-COGS, BULLET, LOAN-REVENUE, INCOME-USE, METRIC-INPUT) sinh T# kèm số liệu và công thức; không có mức S, không chặn | lac-rules §7 |
| FR-12 | Lớp chỉ số: LTV, DSCR, số vay/doanh thu năm, phương án/giá vốn năm, gốc cuối kỳ/lợi nhuận cả kỳ, biên lợi nhuận; thiếu đầu vào → "chưa tính được" + đầu vào thiếu; thông tin có C → giá trị thận trọng + cờ | lac-rules §7 |
| FR-13 | Không bao giờ tự sửa số tiền, số định danh, chủ sở hữu khi có lệch thật; nghi ngờ thì xếp C | lac-rules §1 |
| FR-14 | Xuất `lac.json` theo JSON Schema có version (LAC_INTEGRATION P2), gồm facts, links, discrepancies, signals, metrics, phase1, sources, và bản trích cho nhánh 2 | LAC §8.2 |

### 5.4 Nhánh 1 · Soát dữ liệu (HITL)
| ID | Yêu cầu |
|---|---|
| FR-15 | Tạo ReviewTask theo X#, ưu tiên S1 → S2 → S3; N tự đóng (chỉ hiện ở phụ lục) |
| FR-16 | Mỗi X# hiển thị giá trị theo từng nguồn, giá trị chuẩn, quy tắc, và vùng ảnh (khi Core có bbox — C6) |
| FR-17 | Hành động: xác nhận phân loại; đổi phân loại (A↔B↔C, A\|B → A hoặc B); sửa giá trị lỗi A (bắt buộc lý do); yêu cầu RM bổ sung (B); xác nhận liên kết người mức trung bình |
| FR-18 | Đọc lại vùng ảnh qua Core (C12) khi chuyên viên yêu cầu |
| FR-19 | Người xử lý ≠ maker; role từ IdP; mọi hành động ghi audit trước/sau |

### 5.5 Nhánh 2 · Thẩm định AI
| ID | Yêu cầu |
|---|---|
| FR-20 | Đầu vào là bản trích LAC (giá trị chuẩn, liên kết, chỉ số, mâu thuẫn C, T#, giới hạn dữ liệu); không nhận biến thể A/B |
| FR-21 | Gọi AIHub qua Core (`generate` hoặc `analyze` với prompt template có version — C2); đầu ra JSON `[{id: K#, text, fields: [F#], conflicts: [X#], signals: [T#]}]` |
| FR-22 | Code kiểm đầu ra: mọi F#/X#/T# trích dẫn phải tồn tại; mỗi con số trong `text` phải khớp một giá trị F# hoặc chỉ số sau chuẩn hoá; vi phạm → loại K# đó, ghi lỗi, không tự sửa |
| FR-23 | K# không được chứa đề xuất cho vay/từ chối (kiểm bằng danh sách cụm từ + schema) |

### 5.6 Bước ghép (code, trong workflow)
| ID | Yêu cầu |
|---|---|
| FR-24 | Còn S1 chưa xử lý → `PENDING_SUPPLEMENT`; K# trích F# đang vướng S2 → K# gắn `PROVISIONAL` kèm điều kiện; không còn S1 và không K# vướng S2 → `ELIGIBLE_TO_SUBMIT` |
| FR-25 | Nhánh 1 đổi phân loại hoặc giá trị: C → A/B rút mâu thuẫn; A/B → C thêm mâu thuẫn; giá trị chuẩn đổi → tính lại chỉ số và T# liên quan; **chỉ chạy lại K# có trích F# bị ảnh hưởng** |
| FR-26 | Mỗi lần ghép phát sự kiện cập nhật trạng thái cho LOS (`run.updated`) |

### 5.7 Cấu hình
| ID | Yêu cầu |
|---|---|
| FR-27 | Toàn bộ bảng ở lac-rules §8 (hiệu lực CIC, ngưỡng lệch tài chính, chứng từ cũ, LTV margin, PLAN-COGS, LOAN-REVENUE, điểm gán người, mã tỉnh CCCD, mốc đổi thẻ, K1–K3, bảng thẩm quyền, nhóm nguồn) và checklist sản phẩm nằm trong file cấu hình có version, tách khỏi code |
| FR-28 | Version cấu hình DRAFT → APPROVED (maker-checker); run chỉ dùng version APPROVED và ghi version vào `lac.json` |

## 6. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NFR-1 | Lớp LAC tất định: cùng đầu vào + cùng version cấu hình → cùng `lac.json` (byte-identical sau sắp xếp khoá) |
| NFR-2 | Lớp LAC ≤ 1 giây/hồ sơ (PoC ~15 ms); không gọi mạng |
| NFR-3 | Không mất/lặp bước khi restart worker (TS hoặc Python); gọi Core idempotent |
| NFR-4 | Không log giá trị trường của người (họ tên, số định danh, SĐT, địa chỉ); log F#/X# và hash |
| NFR-5 | Bản trích nhánh 2 ≤ 25% kích thước JSON DU (PoC: 17%); đo bằng tokenizer thật của model AIHub |
| NFR-6 | Test và CI chỉ dùng hồ sơ giả lập; dữ liệu thật chỉ ở môi trường được phê duyệt (LAC-4) |

## 7. Phụ thuộc

| Phụ thuộc | Cần cho | Trạng thái |
|---|---|---|
| Khung Apps (Phase A) | Mọi thứ | Kế hoạch |
| Core C6 mở rộng (trang, bbox, độ tin cậy, `status`, `candidates` theo trường) | FR-16, phân loại A/B | Cần DU |
| Core C11 (họ tên trong mọi bản ghi, chủ thể trên thẻ chứng từ) | FR-5, FR-8 | Cần DU |
| Core C12 (đọc lại vùng ảnh) | FR-18 | Cần DU |
| Core C2 (prompt template) + C7–C9 (connector AIHub) | FR-21 | Cần Core + đặc tả AIHub |
| Contract đầu ra DU `dugate.loan-appraisal.integration 5.0` | FR-7 | LAC-3 |
| Cấu hình đã chốt (lac-rules §8) | FR-27 | Các đơn vị chốt; dùng giá trị tạm khi dev |

## 8. Acceptance criteria

Trên bộ fixture giả lập (≥ 5 hồ sơ, mỗi hồ sơ cài sẵn các tình huống dưới):

- [ ] AC-1: Cổng GĐ1 phát hiện CIC đúng loại, còn hạn nhưng **của vợ/chồng** người vay → mục CIC `THIẾU`, nêu "cần CIC của người vay"; `STRICT` dừng trước GĐ2.
- [ ] AC-2: Bốn cách viết một địa chỉ (có/không cấp huyện, có/không tiền tố) → một F#, sai lệch loại N, không đi sang nhánh 2.
- [ ] AC-3: Thu nhập 180 tr/tháng trên đơn vay, 180 tr/năm trên bảng kê → X# loại C1 mức S2, giá trị chuẩn thận trọng, có trong bản trích nhánh 2.
- [ ] AC-4: Giấy kết hôn cũ ghi thẻ cũ, thẻ mới cấp sau → N (giá trị thời kỳ trước), không báo lệch.
- [ ] AC-5: Hai chứng từ tự khai cùng ghi một giá trị sai, giấy tờ bậc 1 ghi khác → giá trị chuẩn theo bậc 1 (đa số tự khai không thắng).
- [ ] AC-6: Mọi T# và chỉ số khớp bảng tính đối chứng của fixture; DSCR thiếu lãi suất số → "chưa tính được: thiếu lãi suất".
- [ ] AC-7: NFR-1 — chạy LAC hai lần cho cùng đầu vào → `lac.json` giống hệt.
- [ ] AC-8: K# trích F# không tồn tại hoặc chứa con số không có trong LAC → bị loại (FR-22).
- [ ] AC-9: Còn S1 → `PENDING_SUPPLEMENT`; xử lý hết S1, còn S2 trên F# được K# trích → `PROVISIONAL`; xử lý hết → `ELIGIBLE_TO_SUBMIT`.
- [ ] AC-10: Nhánh 1 hạ X# thu nhập từ C xuống A3 và sửa giá trị → chỉ K# trích F# thu nhập chạy lại (kiểm bằng số lần gọi Core), các K# khác giữ nguyên.
- [ ] AC-11: Người xử lý nhánh 1 trùng maker → 403.
- [ ] AC-12: Kill worker Python trong lúc dựng LAC → Temporal retry, workflow tiếp tục, không trùng kết quả.
- [ ] AC-13 (đo thật, LAC-4): trên 50–100 hồ sơ đã thẩm định, đo theo LAC §7.2; mục tiêu tỷ lệ sửa sai trên K1 = 0.

## 9. Câu hỏi mở

| # | Câu hỏi | Mức độ | Ghi chú |
|---|---|---|---|
| LAC-3 | Đầu ra DU `dugate.loan-appraisal.integration 5.0` sinh ở đâu, có thuộc Core không? | Critical | Quyết định adapter đầu vào FR-7 |
| LAC-4 | Môi trường nào được chạy hồ sơ thật để đo? | Critical | AC-13 |
| Q1 | LOS nào gọi App; LOS có mở deep-link màn hình nhánh 1 không? | Critical | FR-15–17 |
| Q2 | Checklist chính thức PP-HKD-SECURED (8 mục, 5 nhóm) và quy tắc chứng từ thay thế | Critical | FR-5; do Sản phẩm cung cấp |
| Q3 | Quy tắc với vợ/chồng người vay: vai trò, chữ ký, giấy tờ bắt buộc | High | BU; ảnh hưởng R-ROLE, R-SOURCE, R-X-MARITAL-ASSET |
| Q4 | Chế độ mặc định khi GĐ1 chưa đủ: `STRICT` hay `TRIAL`? | Medium | Đề xuất `STRICT` ở production |
| Q5 | Ai được đổi phân loại C → A/B ở nhánh 1 (chuyên viên soát hay cấp kiểm soát)? | High | Ảnh hưởng FR-17, FR-19 |

## Phụ lục — Loại chứng từ v1 (theo PoC; Sản phẩm chốt ở Q2)

| `doc_type` | Chứng từ | Nhóm checklist | Nhóm nguồn độc lập |
|---|---|---|---|
| `id_card` | CCCD / Căn cước | Pháp lý | Dân cư |
| `qr_code_info` | Thông tin QR trên thẻ | Pháp lý (thay thế) | Dân cư |
| `vneid` | VNeID | Pháp lý (thay xác nhận cư trú) | Dân cư |
| `marriage_certificate` | Giấy chứng nhận kết hôn | Pháp lý | Riêng |
| `loan_application` | Giấy đề nghị vay kiêm phương án sử dụng vốn | Phương án vay | Tự khai |
| `purchase_list` | Bảng kê hàng hoá cần nhập | Phương án vay (thay hợp đồng) | Tự khai |
| `income_statement` | Bảng kê thu nhập | Nguồn thu nhập | Tự khai |
| `land_use_certificate` | GCN quyền sử dụng đất | Tài sản bảo đảm | Riêng |
| `valuation_certificate` | Chứng thư / biên bản định giá | Tài sản bảo đảm | Riêng |
| `cic` | Báo cáo CIC | Quan hệ tín dụng | Riêng |
