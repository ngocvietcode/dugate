# Spec 002: App Hỗ trợ thẩm định tín dụng SME (`credit-appraisal-assist`)

- **Trạng thái**: Draft — chờ trả lời câu hỏi Critical (§9)
- **Tầng**: Apps ([ADR-0002](../../docs/adr/0002-core-apps-layering.md)), chạy trên Temporal ([ADR-0001](../../docs/adr/0001-temporal-orchestration.md))
- **Thay thế**: spec 001 (phần nền tảng Apps được gộp vào Phase A của spec này)

## 1. Bối cảnh & vấn đề

Chuyên viên thẩm định (CVTĐ) khối SME mất phần lớn thời gian cho việc **đọc, nhập lại số liệu và đối chiếu** bộ hồ sơ (BCTC nhiều năm, tờ khai thuế, đăng ký doanh nghiệp, nghị quyết vay vốn, phương án kinh doanh, hồ sơ tài sản bảo đảm, báo cáo CIC…) trước khi bắt đầu phần việc cần chuyên môn: đánh giá và đề xuất.

App tự động hóa phần đọc–nhập–đối chiếu–tính toán–soạn nháp, **có bằng chứng tới từng con số**, để CVTĐ tập trung vào đánh giá. **Quyết định cấp tín dụng không thuộc App**: phê duyệt theo thẩm quyền vẫn thực hiện trên LOS.

## 2. Phạm vi

### Trong phạm vi (v1)
- Khách hàng doanh nghiệp SME, khoản vay mới (hạn mức vốn lưu động hoặc vay trung dài hạn theo món).
- Phân loại & kiểm tra **đầy đủ** bộ hồ sơ theo checklist sản phẩm.
- Trích xuất số liệu có bằng chứng; CVTĐ soát/sửa.
- Kiểm tra **tính nhất quán** (nội bộ BCTC, giữa các năm, BCTC ↔ tờ khai thuế, pháp lý giữa các tài liệu, TSBĐ).
- Tính **chỉ tiêu tài chính** và **nhu cầu vốn** bằng code xác định.
- Đối chiếu **chính sách tín dụng** (ngưỡng có version) → danh sách ngoại lệ.
- Soạn **dự thảo tờ trình thẩm định** (các phần định lượng từ số liệu đã soát; phần diễn giải do AI viết, đánh dấu là dự thảo).

### Ngoài phạm vi
- Phê duyệt, từ chối, chấm điểm xếp hạng tín dụng nội bộ chính thức (XHTD do LOS/hệ thống xếp hạng sở hữu — App chỉ nhận kết quả qua `context` nếu có).
- Truy vấn CIC, core banking, hệ thống xếp hạng, hệ thống quản lý TSBĐ (L6: chỉ nhận qua `context` hoặc tài liệu).
- Tính giới hạn cấp tín dụng theo nhóm khách hàng liên quan (cần dữ liệu dư nợ toàn hệ thống — chỉ kiểm tra nếu `context` cung cấp số liệu).
- Định giá TSBĐ (App đọc chứng thư thẩm định giá, không định giá).
- Khách hàng cá nhân, doanh nghiệp lớn, tài trợ dự án (phiên bản sau).

## 3. Tác nhân

| Tác nhân | Vai trò với App |
|---|---|
| LOS (hệ thống gọi) | Start run với `context` + URL tài liệu ECM; nhận sự kiện; giữ user task, quyết định |
| CV QHKH (maker hồ sơ) | Người lập hồ sơ trên LOS — `makerUserId` |
| CV thẩm định (CVTĐ) | Soát/sửa số liệu trích xuất trên workbench; xác nhận hoàn tất soát |
| Khối Quản lý rủi ro / Chính sách | Sở hữu & phê duyệt `CreditPolicyRuleSet` (version) |
| Kiểm toán nội bộ | Đọc audit, truy vết bằng chứng |

## 4. Luồng nghiệp vụ

```
LOS ──start──▶ [A] Validate context + kiểm kê file
               [B] Phân loại tài liệu (per file, song song)        → Core analyze:classify
               [C] Kiểm tra đầy đủ hồ sơ (checklist theo sản phẩm)  → rule (code)
                    └─ thiếu tài liệu bắt buộc → finding MISSING_DOCUMENT (không dừng run)
               [D] Trích xuất theo loại tài liệu (song song)        → Core extract:custom (schema có _evidence)
               [E] Chuẩn hóa (đơn vị, kỳ, dấu) + cờ độ tin cậy        → code
               [F] ⏸ REVIEW_EXTRACTION — CVTĐ soát/sửa số liệu     → event run.review_required
                    (bắt buộc với BCTC & tờ khai; mode DELEGATED/EMBEDDED)
               [G] Kiểm tra nhất quán                               → rule (code)
               [H] Tính chỉ tiêu tài chính & nhu cầu vốn             → code (decimal)
               [I] Đối chiếu chính sách tín dụng (RuleSet version)   → rule (code)
               [J] Soạn dự thảo tờ trình                              → template (code) + Core generate:report (diễn giải)
               [K] Kiểm tra số liệu trong phần diễn giải             → code (mọi con số phải có trong dữ liệu đã soát)
LOS ◀─run.completed── findings + metrics + extracted + memo draft
```

Nguyên tắc: **AI đọc & viết; code tính & kết luận.** Không có chỉ tiêu, ngưỡng, hay kết luận đạt/không đạt nào do LLM sinh ra.

## 5. Yêu cầu chức năng

### 5.1 Đầu vào
| ID | Yêu cầu |
|---|---|
| FR-1 | `POST /apps/v1/credit-appraisal-assist/runs` theo Workflow Service Contract (LAYERED_ARCHITECTURE §5). Idempotent theo `(caller, app, requestId)` |
| FR-2 | `context` bắt buộc: `applicant` (tên, MST, ngành VSIC, ngày thành lập, người đại diện theo pháp luật), `request` (sản phẩm, số tiền, loại tiền, mục đích, thời hạn, phương thức cho vay, lãi suất dự kiến), `collaterals[]` (loại, mô tả, chủ sở hữu khai báo), `policy` (`ruleSetId`, `version`). Tùy chọn: `internalRating`, `existingExposure`, `cicSummary` |
| FR-3 | Thiếu trường bắt buộc / sai kiểu → 400 với danh sách lỗi; **không** tự đi lấy dữ liệu (L6) |
| FR-4 | Tài liệu qua `documents[].url` (ECM); tối đa 50 file / 500 trang mỗi run (cấu hình) |

### 5.2 Phân loại & đầy đủ hồ sơ
| ID | Yêu cầu |
|---|---|
| FR-5 | Phân loại vào danh mục cố định (Phụ lục A); một file có thể chứa nhiều tài liệu logic (theo trang) |
| FR-6 | Checklist bắt buộc/tùy chọn theo `request.product` lưu trong RuleSet; thiếu → finding `MISSING_DOCUMENT` (HIGH nếu bắt buộc) |
| FR-7 | Tài liệu hết hiệu lực (vd. chứng thư thẩm định giá quá hạn, CIC quá số ngày quy định) → `EXPIRED_DOCUMENT` |

### 5.3 Trích xuất & soát
| ID | Yêu cầu |
|---|---|
| FR-8 | Mỗi loại tài liệu có schema trích xuất (Phụ lục B); **mỗi trường** kèm `_evidence: { documentId, page, quote }` |
| FR-9 | Chuẩn hóa đơn vị (đồng / nghìn / triệu theo ghi chú "Đơn vị tính" trên BCTC), kỳ báo cáo, số âm trong ngoặc |
| FR-10 | Điểm soát `REVIEW_EXTRACTION`: CVTĐ xem từng trường cạnh bằng chứng, sửa giá trị (ghi lý do), xác nhận. Trường có độ tin cậy thấp hoặc không có bằng chứng được đánh dấu bắt buộc xem |
| FR-11 | Người xác nhận soát ≠ `makerUserId`; có role `CREDIT_APPRAISER` (từ IdP) |
| FR-12 | Quá hạn soát (mặc định 10 ngày làm việc — cấu hình) → `run.failed` reason `REVIEW_TIMEOUT` |

### 5.4 Kiểm tra nhất quán (rule code, mỗi rule có id/version + test)
| ID | Kiểm tra |
|---|---|
| CON-1 | BCĐKT: Tổng tài sản = Tổng nguồn vốn (dung sai cấu hình) cho từng năm |
| CON-2 | Số đầu kỳ năm N = số cuối kỳ năm N-1 cho các khoản chính |
| CON-3 | Lợi nhuận sau thuế KQKD khớp biến động LNST chưa phân phối (cảnh báo nếu lệch, có chia cổ tức) |
| CON-4 | Doanh thu BCTC so với doanh thu trên tờ khai thuế GTGT/TNDN cùng kỳ — lệch quá ngưỡng → finding |
| CON-5 | Tên DN, MST, người đại diện thống nhất giữa ĐKDN, BCTC, nghị quyết, hợp đồng, `context.applicant` |
| CON-6 | Nghị quyết/biên bản của cấp có thẩm quyền theo điều lệ chấp thuận vay với số tiền ≥ `request.amount`, đúng mục đích, còn hiệu lực |
| CON-7 | Ngành nghề trên ĐKDN phù hợp mục đích vay — **AI gợi ý, đánh dấu `NEEDS_JUDGMENT`**, không kết luận |
| CON-8 | TSBĐ: chủ sở hữu trên giấy tờ khớp khai báo; giá trị theo chứng thư; ngày chứng thư còn hiệu lực |

### 5.5 Chỉ tiêu tài chính (code, số thập phân chính xác)
| ID | Chỉ tiêu |
|---|---|
| FIN-1 | Thanh khoản: hệ số thanh toán hiện hành, nhanh |
| FIN-2 | Đòn bẩy: Nợ phải trả / Vốn chủ sở hữu, Nợ vay / Tổng tài sản |
| FIN-3 | Sinh lời: biên LN gộp, ROS, ROA, ROE |
| FIN-4 | Hoạt động: vòng quay hàng tồn kho, phải thu, phải trả; vòng quay vốn lưu động |
| FIN-5 | Tăng trưởng doanh thu, LNST qua các năm |
| FIN-6 | Nhu cầu vốn lưu động = chi phí hoạt động kế hoạch / vòng quay VLĐ − vốn tự có − vốn vay TCTD khác (theo công thức trong RuleSet) |
| FIN-7 | Trung dài hạn: tỷ lệ vốn tự có tham gia; DSCR theo dòng tiền phương án |
| FIN-8 | TSBĐ: LTV = dư nợ đề xuất / giá trị TSBĐ được tính theo tỷ lệ cho vay tối đa của từng loại tài sản |

Mỗi chỉ tiêu lưu công thức, các giá trị đầu vào (đã soát) và trỏ được về bằng chứng của từng đầu vào.

### 5.6 Chính sách tín dụng
| ID | Yêu cầu |
|---|---|
| FR-13 | `CreditPolicyRuleSet` có version, trạng thái DRAFT → APPROVED (maker-checker); run dùng đúng version trong `context.policy` và chỉ chấp nhận version APPROVED |
| FR-14 | Mỗi rule: ngưỡng theo ngành/sản phẩm (vd. hệ số thanh toán hiện hành ≥ x, Nợ/VCSH ≤ y, DSCR ≥ z, LTV ≤ t, số năm hoạt động ≥ n, LNST dương k năm gần nhất) → finding `POLICY_EXCEPTION` kèm giá trị thực tế, ngưỡng, rule id/version |

### 5.7 Dự thảo tờ trình
| ID | Yêu cầu |
|---|---|
| FR-15 | Tờ trình theo mẫu (cấu hình theo ngân hàng): thông tin KH, pháp lý, tình hình tài chính, phương án vay, TSBĐ, rủi ro & ngoại lệ, đề xuất của CVTĐ (để trống) |
| FR-16 | Bảng số liệu & chỉ tiêu do template điền từ dữ liệu đã soát (không qua LLM) |
| FR-17 | Phần diễn giải (nhận xét tài chính, đánh giá phương án) do AI soạn, gắn nhãn "Dự thảo AI — CVTĐ chịu trách nhiệm hiệu chỉnh" |
| FR-18 | Guard: mọi con số trong phần diễn giải phải khớp một giá trị trong dữ liệu đã soát/chỉ tiêu (sau chuẩn hóa); không khớp → đoạn bị loại và ghi finding `NARRATIVE_NUMBER_UNVERIFIED` |
| FR-19 | Xuất `.docx` và `.md`; LOS/CVTĐ tự hiệu chỉnh & lưu ECM |

### 5.8 Đầu ra
| ID | Yêu cầu |
|---|---|
| FR-20 | `outcome` ∈ `NO_EXCEPTIONS` \| `EXCEPTIONS_FOUND` \| `INCOMPLETE` — mô tả trạng thái hồ sơ, **không** phải đề xuất cho vay/từ chối |
| FR-21 | `findings[]`, `metrics[]`, `extracted`, `memo` (ref), `trace` (core operations, prompt versions, ruleSet version, model) |
| FR-22 | Sự kiện `run.review_required`, `run.completed`, `run.failed` tới callback (HMAC) |

## 6. Yêu cầu phi chức năng & tuân thủ

| ID | Yêu cầu | Liên quan |
|---|---|---|
| NFR-1 | Thời gian xử lý máy (không tính chờ soát) p95 ≤ 15 phút cho 30 file / 300 trang | |
| NFR-2 | Không mất/lặp bước khi restart worker; gọi Core idempotent theo `runId+stepKey` | Constitution §11 |
| NFR-3 | Tiền & chỉ tiêu tính bằng decimal, làm tròn theo quy định trong RuleSet | §9 |
| NFR-4 | Audit: start, mỗi sửa đổi (trước/sau/lý do/người), xác nhận soát, ruleSet version dùng | §8 |
| NFR-5 | PII (CCCD người đại diện, số tài khoản) không log; LLM chỉ qua AIHub (chính sách dữ liệu do AIHub quản trị) | §2, ADR-0003 |
| NFR-6 | Dữ liệu làm việc có TTL (L5); bản cuối do LOS lưu ECM | L5 |
| NFR-7 | Chất lượng trích xuất trên golden set: ≥ 95% trường BCTC chính đúng sau chuẩn hóa (trước soát) — ngưỡng chốt với nghiệp vụ | §16 |
| NFR-8 | Khung pháp lý tham chiếu (Pháp chế xác nhận): Luật Các TCTD 2024, Thông tư 39/2016/TT-NHNN và sửa đổi về cho vay, quy định nội bộ về thẩm định | |

## 7. Phụ thuộc

| Phụ thuộc | Cần cho | Ghi chú |
|---|---|---|
| Khung Apps (Temporal dev, contract, core-client, workbench khung) | Mọi thứ | Phase A của spec này |
| Core C5 — role `APP` | Gọi Core với hạn mức riêng | Có thể dùng key STANDARD ở dev |
| Core C2 — prompt template `prompt_ref` | Phân loại tốt hơn & diễn giải tờ trình theo từng phần | v1 tạm dùng `categories`/`schema` và override prompt theo profile (cơ chế `ExternalApiOverride` đã có) |
| Core C4 — document handle | Không OCR lại mỗi bước | Hiệu năng; không chặn v1 |
| Core C6 — evidence bbox | Tô vùng trên trang | v1 dùng `page + quote` trong schema |
| Core C7–C9 — connector AIHub (body JSON, OAuth2/mTLS, model + request id) | Chạy với AIHub thật | Phụ thuộc đặc tả API AIHub (AIHUB_INTEGRATION §6); dev dùng mock-service |
| Mẫu tờ trình, checklist, RuleSet ban đầu | §5.2, §5.6, §5.7 | **Nghiệp vụ cung cấp** |
| Golden set ≥ 20 hồ sơ SME ẩn danh | NFR-7 | **Nghiệp vụ cung cấp** |

## 8. Acceptance criteria

- [ ] AC-1: Run với bộ hồ sơ mẫu đầy đủ → phân loại đúng 100% tài liệu bắt buộc trong bộ mẫu; checklist không báo thiếu.
- [ ] AC-2: Bỏ BCTC năm gần nhất khỏi bộ mẫu → finding `MISSING_DOCUMENT` HIGH; run vẫn tới bước soát.
- [ ] AC-3: Mỗi trường trích xuất hiển thị trên workbench có trang + trích dẫn; trường thiếu bằng chứng được đánh dấu bắt buộc xem.
- [ ] AC-4: Người xác nhận soát trùng `makerUserId` → bị từ chối (403), run vẫn chờ.
- [ ] AC-5: Bộ BCTC có TS ≠ NV vượt dung sai → `CON-1` finding với giá trị hai vế và bằng chứng.
- [ ] AC-6: Tất cả FIN-* khớp bảng tính đối chứng do nghiệp vụ lập cho bộ mẫu (sai số 0 sau làm tròn).
- [ ] AC-7: Đổi `policy.version` → ngoại lệ thay đổi đúng theo ngưỡng mới; version DRAFT bị từ chối khi start.
- [ ] AC-8: Chèn con số bịa vào phần diễn giải (test) → đoạn bị loại, có `NARRATIVE_NUMBER_UNVERIFIED`.
- [ ] AC-9: Kill worker trong bước trích xuất → khởi động lại, run tiếp tục; Core ghi nhận không có Operation trùng cho cùng `stepKey`.
- [ ] AC-10: Output không chứa trường/ngôn ngữ "đề xuất cho vay/từ chối"; `outcome` chỉ thuộc tập FR-20.
- [ ] AC-11: Audit truy vết được: giá trị cuối của một chỉ tiêu → đầu vào → sửa đổi của CVTĐ (nếu có) → bằng chứng gốc.

## 9. Câu hỏi mở

| # | Câu hỏi | Mức độ | Đề xuất |
|---|---|---|---|
| Q1 | Hệ thống gọi là LOS nào; LOS có hiển thị deep-link workbench không (L2, L3)? | Critical | `DELEGATED` + deep-link; dev dùng `EMBEDDED` |
| Q2 | Ai cung cấp & phê duyệt checklist, RuleSet ngưỡng chính sách, công thức nhu cầu vốn (L4)? | Critical | Khối QLRR sở hữu; App lưu version + maker-checker |
| Q3 | Mẫu tờ trình thẩm định SME hiện hành của ngân hàng? | Critical | Cần file mẫu |
| Q4 | ~~Có được gửi BCTC/hồ sơ KH tới LLM ngoài không (D2)?~~ | — | **Đã trả lời**: LLM qua VPBank AIHub bằng connector (ADR-0003) |
| Q9 | AIHub có nhận PDF/ảnh (OCR/vision) và structured JSON output không (AIHUB A3, A6)? | Critical | Quyết định bước ingest/extract có cần engine OCR riêng |
| Q5 | Có golden set hồ sơ ẩn danh không? Bao nhiêu? | High | ≥ 20 bộ, có bảng tính đối chứng |
| Q6 | BCTC dạng nào phổ biến: PDF scan, PDF số, XML từ HTKK/eTax? | High | Hỗ trợ PDF scan + PDF số; XML là phase sau (chính xác 100%) |
| Q7 | Một run cho một khoản vay hay cho cả phương án nhiều khoản/hạn mức? | Medium | Một `request` / run |
| Q8 | Có cần lần soát thứ hai (cấp kiểm soát thẩm định) trong App hay trên LOS? | Medium | Trên LOS |

---

## Phụ lục A — Danh mục tài liệu v1

| Mã | Tài liệu | Bắt buộc (mặc định) |
|---|---|---|
| `LEGAL_ERC` | Giấy chứng nhận đăng ký doanh nghiệp | ✔ |
| `LEGAL_CHARTER` | Điều lệ công ty | ✔ |
| `LEGAL_RESOLUTION` | Nghị quyết/Biên bản HĐTV/ĐHĐCĐ/HĐQT về vay vốn, thế chấp | ✔ |
| `LEGAL_REP_ID` | Giấy tờ tùy thân người đại diện theo pháp luật | ✔ |
| `FIN_BS` | Bảng cân đối kế toán (theo năm) | ✔ 2 năm gần nhất |
| `FIN_IS` | Báo cáo kết quả kinh doanh (theo năm) | ✔ 2 năm gần nhất |
| `FIN_CF` | Báo cáo lưu chuyển tiền tệ | |
| `FIN_NOTES` | Thuyết minh BCTC | |
| `FIN_AUDIT` | Báo cáo kiểm toán | theo RuleSet |
| `TAX_VAT` / `TAX_CIT` | Tờ khai thuế GTGT / quyết toán TNDN | ✔ (một trong hai) |
| `PLAN_BUSINESS` | Phương án kinh doanh / dự án đầu tư, kế hoạch trả nợ | ✔ |
| `CONTRACT_INPUT` / `CONTRACT_OUTPUT` | Hợp đồng mua vào / bán ra chứng minh phương án | |
| `BANK_STATEMENT` | Sao kê tài khoản | |
| `CIC_REPORT` | Báo cáo thông tin tín dụng CIC | ✔ |
| `COL_TITLE` | Giấy chứng nhận QSDĐ/QSH tài sản, đăng ký xe… | ✔ nếu có TSBĐ |
| `COL_VALUATION` | Chứng thư thẩm định giá | ✔ nếu có TSBĐ |
| `OTHER` | Khác | |

## Phụ lục B — Schema trích xuất (ví dụ `FIN_BS`)

```jsonc
{
  "period_end": "2025-12-31",
  "unit": "VND | THOUSAND_VND | MILLION_VND",
  "lines": {
    "current_assets":        { "value": "…", "_evidence": { "page": 1, "quote": "…" } },
    "cash":                  { "value": "…", "_evidence": {…} },
    "short_term_receivables":{ "value": "…", "_evidence": {…} },
    "inventories":           { "value": "…", "_evidence": {…} },
    "non_current_assets":    { "value": "…", "_evidence": {…} },
    "total_assets":          { "value": "…", "_evidence": {…} },
    "current_liabilities":   { "value": "…", "_evidence": {…} },
    "short_term_borrowings": { "value": "…", "_evidence": {…} },
    "long_term_liabilities": { "value": "…", "_evidence": {…} },
    "long_term_borrowings":  { "value": "…", "_evidence": {…} },
    "owners_equity":         { "value": "…", "_evidence": {…} },
    "total_resources":       { "value": "…", "_evidence": {…} }
  },
  "comparative_period": { /* số đầu năm, cùng cấu trúc */ }
}
```
Mã dòng ánh xạ theo mẫu B01-DN (TT 200/2014) và B01-DNN (TT 133/2016) — bảng ánh xạ là dữ liệu cấu hình, có test.
