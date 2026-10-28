# Hồ sơ 360 có kiểu và duyệt mâu thuẫn bởi CO (`loan_360`)

> Trạng thái: **ĐỀ XUẤT (D-108, 2026-10-27), chưa cài đặt.** Mở rộng [loan_application_context.md](loan_application_context.md) (LAC, D-103).
> Phạm vi: thẩm định **từng hồ sơ**; không lưu xuyên hồ sơ, không tích hợp nguồn ngoài (CIC, core, đăng ký kinh doanh).
> Người quyết khi chứng từ mâu thuẫn là **CO**; luồng: workflow chạy xong → CO duyệt → hệ thống **tính lại**.

## 1. Mục đích

Dựng một view 360 duy nhất của khoản vay: khoản vay, khách vay, người liên quan, tài sản, nguồn thu, nghĩa vụ nợ, hộ kinh doanh.
Hiện trạng (đọc code 2026-10-27):

1. Có bốn bản chiếu chồng nhau của cùng hồ sơ: `customer_360` (S3), `DossierGraph`, sổ Claim, LAC.
2. **Hai nguồn sự thật cho số liệu.** `financial-inputs.ts` đọc thẳng `income_statement` / `loan_application` từ evidence rồi tự chọn
   giá trị; LAC chỉ là view cho prompt (OQ-LAC-03). Quyết định của CO trên LAC sẽ không ảnh hưởng DSCR nếu giữ nguyên.
3. Nguồn thu và nghĩa vụ chỉ là fact rời; không có thực thể để cộng, so sánh, tính. Hộ kinh doanh chỉ có `business-1` (OQ-LAC-02).
4. Mâu thuẫn chỉ được gắn nhãn; không có cách ghi lại ai chọn giá trị nào, vì sao.

## 2. Mô hình: ba lớp, một chiều

```
documents.evidences (bất biến) ─► Claim ledger ─► Lớp 1: Fact + trust (LAC build, hiện có)
CO resolutions (đầu vào, lưu kèm Operation) ────────────────┤
                                                            ▼
                       Lớp 2: Hồ sơ 360 có kiểu  (Loan, Party, Asset, BusinessUnit, IncomeStream, Obligation)
                                                            │
        ┌──────────────────────┬───────────────────────────┼──────────────────────┐
  Tính tài chính (stage 2)   Rule engine + Rule LLM      LAC render (prompt)     UI / payload tích hợp
```

Mọi nơi phía dưới đọc **lớp 2**; không nơi nào đọc evidence trực tiếp để tự chọn giá trị.

## 3. Lớp 2: thực thể có kiểu

| Thực thể | Trường chuẩn | Ghi chú |
|---|---|---|
| `Loan` | số tiền đề nghị, số tiền đề xuất, kỳ hạn, lãi suất, mục đích | từ chủ thể `loan` của LAC |
| `Party` | `person_id` (S3), vai trò, định danh, quan hệ | dùng nguyên mã S3 |
| `Asset` | `asset_id` (S3), loại, định danh, giá trị định giá, chủ sở hữu hiện tại | dùng nguyên mã S3 |
| `BusinessUnit[]` | mã, ngành, chủ, doanh thu năm, lợi nhuận năm | thay `business-1` duy nhất; khóa gom và quan hệ ở §3.1 |
| `IncomeStream` | loại, chủ (person), số tiền năm, kỳ | từ `income_sources` / `financial_info.income_details` |
| `Obligation` | tổ chức, dư nợ, trả hàng tháng, kỳ hạn còn lại | từ CIC OCR và `existingMonthly` / `debtService`; khóa gộp ở §3.2 |
| `PurchaseDeal`, `Valuation`, `Address`, `Household`, `IdentityDocument`, `Counterparty` | xem §3.1, §3.2 | nhóm gộp bổ sung |

Mỗi trường mang `fact_ids` (nguồn), `trust` và `review`, nên dẫn nguồn và rào `ACCEPTED` của rule LLM giữ nguyên.

### 3.1 Đơn vị kinh doanh và quan hệ (HKD / SME)

#### Hiện trạng (đọc code 2026-10-27)

Thông tin về hộ kinh doanh / doanh nghiệp nằm rải trên nhiều chứng từ, **không bước nào gom chúng thành một thực thể**:

| Chứng từ | Thông tin đơn vị kinh doanh đang bóc tách | Đang dùng thế nào |
|---|---|---|
| `loan_application.business_info` | `business_name`, `business_line`, `business_address`, `tax_id`, `registration_number` | Gắn vào khách vay (`customer_360[].business`); nguồn duy nhất của `business-1` trong LAC |
| `income_statement.income_sources[].household_business` | tên, ngành, địa chỉ thực tế, mặt bằng, doanh thu / lợi nhuận năm | Chỉ `financial-inputs.ts` đọc số liệu |
| `income_statement.income_sources[].enterprise` | `enterprise_name`, `registration_or_tax_number`, `capital_share_percent`, `registered_address`, lợi nhuận | Không nơi nào dùng |
| `household_business_license` (bóc tách nhẹ) | `fields`: số GCN, tên HKD, địa điểm, ngành; party `HOLDER` = chủ hộ | Party được S3 gom về người; `fields` thành fact `doc-n`, không so với đơn vay |
| `local_business_confirmation`, `business_account_ledger`, `household_business_photo` (nhẹ) | ngành, địa chỉ, văn bản nguyên văn | Chỉ checklist có / không |
| `tax_payment_receipt` (nhẹ) | party `TAXPAYER` + `tax_id` | Mã số thuế không dùng để nối |
| `enterprise_registration_license` (nhẹ) | party `ORGANIZATION` (tên, `tax_id`, `representative_name`), `fields`: số ĐK, trụ sở | Gom được chỉ khi pháp nhân có trong đơn vay; người đại diện nối **theo tên**, chỉ khi khớp đúng một người (`customer360.ts`, `organizationOf`) |
| `board_meeting_minutes` (nhẹ) | party công ty + mỗi thành viên là party `OTHER` có tên, CCCD | Không dựng quan hệ thành viên |
| `vat_tax_return`, `balance_sheet`, `financial_performance_report` (nhẹ) | **chỉ kỳ báo cáo**, không số liệu | Không đối chiếu được doanh thu |
| `goods_purchase_contract` (`SELLER` / `BUYER`), `purchase_list` (`CUSTOMER` / `SELLER`) | bên mua, bên bán | Không kiểm bên liên quan |
| `cic`, `credit_contract` | nghĩa vụ nợ tại TCTD khác | Mục checklist scope `DOSSIER`, không gắn người |

Hệ quả: (1) tên / số GCN / ngành / địa chỉ HKD giữa đơn vay, GCN ĐKHKD, bảng kê và xác nhận địa phương không được đối chiếu;
(2) không biết GCN HKD là của ai: mục checklist `income_household_*`, `income_enterprise_*` đều scope `DOSSIER`; (3) SME mới là
khung: chương trình `sme_secured` ghi "chờ nghiệp vụ chốt danh mục", `party_role` của đơn vay chỉ có `BORROWER`, `CO_BORROWER`,
`SPOUSE`, `COLLATERAL_OWNER`, `REFERENCE_PERSON`; (4) không đối chiếu được doanh thu khai với tờ khai thuế / BCTC vì chưa bóc số liệu.

#### Thực thể bổ sung

| Thực thể | Trường chuẩn | Ghi chú |
|---|---|---|
| `BusinessUnit` | `business_id` (`biz-n`), `kind` (`HKD` \| `ENTERPRISE`), tên, số GCN / số ĐK, mã số thuế, ngành, địa điểm kinh doanh, trụ sở | Thay `business-1`; một hồ sơ có thể có nhiều đơn vị (trả lời OQ-LAC-02). Pháp nhân đã có trong registry S3 (`party_type = ORGANIZATION`) dùng chung `person_id` làm `party_id`, `BusinessUnit` trỏ tới nó |
| `Counterparty` | tên, CCCD / mã số thuế, vai trò trên chứng từ (bên bán…) | Party trên chứng từ giao dịch không thuộc registry S3 |

#### Quan hệ

| Cạnh | Từ → Tới | Nguồn | Khóa ghép (theo thứ tự) | Dùng cho | Mức |
|---|---|---|---|---|---|
| `OPERATES` | Party (cá nhân) → `BusinessUnit` HKD | `HOLDER` của GCN ĐKHKD; khách vay + `business_info`; party của bảng kê có nguồn `household_business` | CCCD chủ hộ → số GCN → tên đơn vị + chủ | Chủ HKD; checklist HKD theo người; tách nhiều HKD | P0 |
| `EARNS_FROM` | `IncomeStream` → `BusinessUnit`; `IncomeStream` → Party | `income_sources[]`, `financial_info.income_details[]` | `evidence_id` + `source_index` (dòng), `party_index` (chủ) | Thu nhập theo từng người, từng đơn vị | P0 |
| `LOCATED_AT` | `BusinessUnit` → `Asset` / địa chỉ | địa điểm KD, `actual_address`, `premises_type_raw`, TSBĐ, `asset_lease_contract` | địa chỉ chuẩn hóa (`full_text`) | Mặt bằng sở hữu / thuê / là TSBĐ; thẩm định thực địa | P1 |
| `FILED_BY` | chứng từ thuế / BCTC → `BusinessUnit` | `tax_payment_receipt`, `vat_tax_return`, `balance_sheet`, `financial_performance_report` | mã số thuế + kỳ | So doanh thu khai với doanh thu kê khai thuế (cần P2 để có số liệu) | P1 (nối) / P2 (số liệu) |
| `TRADES_WITH` | Party khách vay / `BusinessUnit` → `Counterparty` | `goods_purchase_contract`, `purchase_list`, `vehicle_sale_contract` | CCCD / mã số thuế bên bán → tên (chỉ cảnh báo) | Bên bán là người liên quan (vợ/chồng, nhân thân, thành viên DN): rủi ro vốn vay quay vòng | P1 |
| `OWES` | Party / `BusinessUnit` → `Obligation` | `cic`, `credit_contract` | CCCD / mã số thuế của `HOLDER` / `BORROWER` | DSCR; gắn CIC theo người thay vì `DOSSIER` | P1 |
| `LEGAL_REP_OF` | Party (cá nhân) → `BusinessUnit` DN | GCN ĐKDN (`representative_name`), biên bản HĐTV | CCCD người đại diện (**chưa bóc**) → tên (đúng một người) | Thẩm quyền ký vay, ký thế chấp; người chấm hồ sơ pháp lý cá nhân của SME (L360-B09). **Bắt buộc** khi khách vay là pháp nhân (L360-B10) | P2 |
| `MEMBER_OF` (kèm `%`) | Party (cá nhân) → `BusinessUnit` DN | biên bản HĐTV, `enterprise.capital_share_percent` | CCCD thành viên → tên | Cơ cấu sở hữu của khách vay SME; với HKD / cá nhân: chứng minh "doanh nghiệp KH làm chủ" (`income_source_enterprise`) | P2 |
| `FUNDS` | `Loan` → `BusinessUnit` | mục đích vay, ngành nghề, chủ đơn vị | SME: chính khách vay (L360-B08); HKD: khách vay ↔ `OPERATES` / `MEMBER_OF` | Mục đích vay phù hợp ngành kinh doanh (rule LLM đọc) | P2 |

`LAC_RELATION` hiện có (`OWNS`, `OWNED_FORMERLY`, `SPOUSE_OF`, `RELATIVE_OF`, `LEGAL_REP_OF`) giữ nguyên; các cạnh trên bổ sung, không thay.

#### Rule

| ID | Rule |
|---|---|
| **L360-B01** | **Gom `BusinessUnit` bằng code, tất định.** Khóa theo thứ tự: mã số thuế / số đăng ký chuẩn hóa (`normIdNumber`) → số GCN ĐKHKD → tên đơn vị (luật tên pháp nhân `orgNameLevel`, bỏ loại hình) **cùng** một chủ `OPERATES`. Không gom chỉ bằng tên. Hai ứng viên cùng khớp → không gom, giữ hai đơn vị và gắn cờ `BUSINESS_MATCH_REVIEW` |
| **L360-B02** | **Mâu thuẫn của đơn vị.** Hai lần nhắc khác số GCN / mã số thuế không bao giờ gộp (AC-12); cùng chủ và cùng tên mà khác số → hai đơn vị, cả hai gắn cờ `BUSINESS_NUMBER_MISMATCH`. Trong một đơn vị (gộp theo số GCN, mã số thuế còn lại khác nhau) → trường đó `DISPUTED`, không chọn giá trị. Tên: chọn giá trị nhắc nhiều nhất, mọi fact vẫn nằm trong `fact_ids`. Ngành và địa chỉ **không** tự sinh mâu thuẫn (địa điểm KD và trụ sở khác nhau là bình thường): render cạnh nhau, rule quyết |
| **L360-B03** | Mỗi cạnh có `verification.status` (`VERIFIED` khi khớp bằng CCCD / mã số thuế, `PARTIAL` khi chỉ khớp tên với đúng một ứng viên, `UNVERIFIED` khi khai mà không có chứng từ) và `support_fact_ids` như LAC-R08. Không dựng cạnh từ tên khi có > 1 ứng viên |
| **L360-B04** | **`IncomeStream` giữ danh tính dòng** (`evidence_id` + `source_index`): không gộp hai dòng cùng số tiền, không tách loại thu nhập khỏi số tiền của nó. Thay cho cách LAC hiện bỏ chỉ số mảng và gộp trùng giá trị (`build.ts`, bước gộp bản nháp) |
| **L360-B05** | **`TRADES_WITH` chỉ cảnh báo.** Bên bán khớp (CCCD / mã số thuế) một Party trong registry, hoặc nối qua `SPOUSE_OF` / `RELATIVE_OF` / `MEMBER_OF` với khách vay → cờ `RELATED_COUNTERPARTY` cho rule đọc. Khớp chỉ bằng tên → `REVIEW`, không kết luận |
| **L360-B06** | Mục checklist `income_household_*` / `income_enterprise_*` **giữ scope `DOSSIER`** (OQ-360-08 đã quyết: chấm theo cả hồ sơ, một bộ là đủ). Kết quả ghi thêm `business_id` và chủ (`OPERATES` / `MEMBER_OF`) của đơn vị thỏa mục đó, chỉ để truy vết; không đổi cách chấm |
| **L360-B07** | PII như L360-R09: không log tên, số GCN, mã số thuế; log chỉ `business_id` và số đếm |
| **L360-B08** | **Khách vay SME là pháp nhân** (OQ-360-06 đã quyết). Party `BORROWER` của hồ sơ SME có `party_type = ORGANIZATION`; `BusinessUnit` `ENTERPRISE` của khách vay dùng chung `party_id` với party đó (không phải đơn vị "do khách vay làm chủ"). `FUNDS` của khoản vay trỏ thẳng tới đơn vị này |
| **L360-B09** | Với khách vay pháp nhân, mục checklist scope `PERSON` của nhóm pháp lý cá nhân (`legal_id_card`, `legal_vneid`, `legal_residence_confirmation`, hôn nhân, khai sinh…) **không chấm trên pháp nhân**; chấm trên người có cạnh `LEGAL_REP_OF` (và người đóng vai trò khác do OQ-360-09 quyết). Hiện S4 không phân biệt `party_type` nên sẽ chấm các mục này trên pháp nhân |
| **L360-B10** | Với khách vay pháp nhân, `LEGAL_REP_OF` là cạnh **bắt buộc**: thiếu, hoặc chỉ `PARTIAL`, → gap `LEGAL_REP_NOT_VERIFIED` (mã mới của `LacGapCode`) cho rule đọc. Điều kiện `income_source_enterprise` ("doanh nghiệp KH làm chủ") không áp cho chính khách vay pháp nhân |
| **L360-B11** | **Số liệu tài chính SME lấy từ BCTC và tờ khai GTGT bóc tách đầy đủ** (OQ-360-07 đã quyết), gắn vào đơn vị qua `FILED_BY` (mã số thuế + kỳ). Mỗi chỉ tiêu là một fact có nguồn, như mọi trường khác. Doanh thu kê khai trên tờ khai GTGT và doanh thu trên BCKQKD cùng kỳ là hai fact riêng; chênh lệch không tự thành `DISPUTED` (kỳ và cơ sở ghi nhận khác nhau), rule quyết |

#### Trường bóc tách đầy đủ đề xuất (L360-B11, BA xác nhận ở OQ-360-12)

| Chứng từ | Trường |
|---|---|
| `vat_tax_return` | mã số thuế, kỳ tính thuế (tháng / quý), doanh thu hàng hóa dịch vụ bán ra, thuế GTGT đầu ra, thuế GTGT đầu vào được khấu trừ, thuế GTGT phải nộp, lần khai (chính thức / bổ sung) |
| `balance_sheet` | mã số thuế, ngày lập / kỳ, tổng tài sản, tiền và tương đương tiền, phải thu ngắn hạn, hàng tồn kho, tài sản cố định, nợ phải trả, vay ngắn hạn, vay dài hạn, vốn chủ sở hữu, có kiểm toán hay không |
| `financial_performance_report` | mã số thuế, kỳ, doanh thu thuần, giá vốn hàng bán, lợi nhuận gộp, chi phí lãi vay, lợi nhuận trước thuế, lợi nhuận sau thuế, có kiểm toán hay không |

### 3.2 Các nhóm gộp khác

Ngoài người, tài sản (S3) và đơn vị kinh doanh (§3.1), tám nhóm thông tin sau nằm rải trên nhiều chứng từ và gộp được. Đọc schema S2
ngày 2026-10-27. Mỗi nhóm có hai việc tách biệt (L360-G01): **nhận diện** các bản ghi cùng một thứ (code, tất định), và **chọn giá trị**
khi chúng ghi khác nhau (chính sách, Risk duyệt).

#### Thực thể và khóa gộp

| # | Thực thể (mã) | Chứng từ nguồn | Khóa gộp (theo thứ tự) | Ghi chú | Mức |
|---|---|---|---|---|---|
| 1 | `Obligation` (`obl-n`) | `cic` (`reports[]`: `institution`, `current_debt_group`, `records_raw`), `credit_contract` (`contract_number`, `loan_amount`, `maturity_date`, bên `LENDER`), `loan_application.financial_info` (`has_existing_debt`, `existing_monthly_debt_payment`) | người / đơn vị vay → tổ chức tín dụng chuẩn hóa → số HĐ → số tiền gốc trong dung sai (OQ-360-18) | CIC chỉ có `records_raw` (văn bản thô) nên chưa gộp được theo khoản (OQ-360-14); lời khai trên đơn vay là một `Obligation` `DECLARED` của người, không gộp vào khoản cụ thể | P1 |
| 2 | `IncomeStream` (`inc-n`) | Lương: `labor_contract` (`monthly_salary`, bên `EMPLOYER`), `salary_confirmation` (`monthly_salary`, `gross_monthly_salary`), `income_sources[].salary`, `financial_info.income_details[]`. Cho thuê: `income_sources[].rental`, `asset_lease_contract`, `rental_payment_receipt`. Kinh doanh: §3.1 `EARNS_FROM` | Lương: người + bên trả lương (mã số thuế → tên pháp nhân). Cho thuê: người + `asset_id`. Kinh doanh: người + `business_id` | `payroll_bank_statement`, `vssid_social_insurance`, HĐ thuê, biên nhận tiền thuê đang bóc tách nhẹ: chỉ chứng minh **có** nguồn thu, không cho số tiền | P1 |
| 3 | `PurchaseDeal` (`deal-n`) | `vehicle_sale_contract` (`total_amount`, xe), `asset_quote` (`quoted_value`, `quoting_company`), `goods_purchase_contract` (`items[]`, `total_amount`), `purchase_list`, `land_use_cert_to_buy`, `construction_estimate_report` | bên bán (Counterparty) + đối tượng: xe = số khung / số máy nếu có, không thì hãng + model + năm sản xuất + màu; hàng hóa = số HĐ, không thì danh mục hàng; đất = `asset_id` | Xe mua mới thường chưa có số khung / biển số trên báo giá, nên S3-R14 không nối báo giá với HĐ mua; `PurchaseDeal` nối hai bản ghi này mà **không** sửa `asset_registry` | P2 |
| 4 | `Valuation` (`val-n`) | `real_estate_valuation_report`, `external_valuation_certificate` (`valuation_value`, `valuation_date`, `appraisal_company`, `valuation_certificate_number`, `validity_period_raw`), `movable_asset_valuation_report`, `asset_details[].declared_value` của đơn vay | `asset_id` (S3) + số chứng thư → đơn vị định giá + ngày định giá | Giá khai trên đơn vay là `Valuation` `DECLARED`, không dùng tính LTV trừ khi chính sách cho phép | P2 |
| 5 | `Address` (`addr-n`) | CCCD, `residence_confirmation` (thường trú, `temporary_address`), đơn vay, GCN (địa chỉ thửa), địa điểm kinh doanh (§3.1), chứng thư định giá | tỉnh mới → xã mới → đường / số nhà chuẩn hóa, sau khi ánh xạ địa danh trước / sau sáp nhập 2025 (OQ-FS-04) | Chưa có bảng ánh xạ thì chỉ gộp khi `full_text` chuẩn hóa trùng; còn lại `NOT_COMPARABLE`, không sinh mâu thuẫn | P3 |
| 6 | `Household` (`hh-n`) | `residence_confirmation` (`household_head_party_index`, `holder_relationship_to_household_head_raw`), `birth_certificate`, `marriage_certificate` | `person_id` chủ hộ + `Address` thường trú | Thành viên nối bằng cạnh `HOUSEHOLD_MEMBER_OF` kèm quan hệ với chủ hộ | P3 |
| 7 | `IdentityDocument` (`idd-n`) | `id_card`, `vneid`, `qr_code_info`, `passport`, `local_cmnd_confirmation`, `same_person_commitment` | `person_id` + loại giấy + số + ngày cấp | Hai bản chụp cùng số, cùng ngày cấp là một giấy. Mở rộng S3-R12 bằng hạn hiệu lực; **không** đổi cách S3 chọn số hiện tại ở v1 | P3 |
| 8 | `Counterparty` (`cp-n`, §3.1) | bên bán, chủ lao động, bên cho vay, công ty định giá, bên thuê | mã số thuế → số CCCD → tên pháp nhân chuẩn hóa (`orgNameLevel` `EXACT`) | Một đối tác có thể giữ nhiều vai (bên bán trên báo giá và trên HĐ); vai cộng dồn | P3 |

#### Rule

| ID | Rule |
|---|---|
| **L360-G01** | **Nhận diện và chọn giá trị là hai bước.** Nhận diện: code tất định, giữ **mọi** bản ghi thành viên với nguồn (lossless). Chọn giá trị: theo `catalog/data/merge_policies.json` có phiên bản, mỗi giá trị được chọn ghi `policy_id`; đổi chính sách do Risk duyệt (cùng tinh thần FS-R12 của [s3_fellegi_sunter.md](s3_fellegi_sunter.md)) |
| **L360-G02** | **Nghĩa vụ nợ không đếm hai lần.** Một khoản trên CIC và HĐ tín dụng cùng khóa (bảng trên) là một `Obligation`; DSCR cộng mỗi `Obligation` một lần. Tổng `Obligation` có chứng từ so với `existing_monthly_debt_payment` khai trên đơn vay: có nợ trên chứng từ mà đơn vay khai không nợ → cờ `UNDECLARED_DEBT`; khai có nợ mà không chứng từ nào thể hiện → `DECLARED_DEBT_NOT_EVIDENCED`. `current_debt_group ≥ 2` → cờ `ADVERSE_DEBT_GROUP`. Cờ cho rule đọc, không tự kết luận |
| **L360-G03** | **Nguồn thu không cộng trùng.** Cùng khóa (bảng trên) là một `IncomeStream` dù xuất hiện trên nhiều chứng từ; DSCR cộng mỗi luồng một lần, số tiền theo chính sách (OQ-360-15). Chứng từ bóc tách nhẹ (sao kê lương, VssID, HĐ thuê, biên nhận) chỉ nâng `evidenced = true` cho luồng, không góp số tiền. Giữ danh tính dòng (L360-B04) |
| **L360-G04** | **Giao dịch mua.** Báo giá, HĐ mua và bảng kê cùng bên bán và cùng đối tượng là một `PurchaseDeal`; giá trên từng chứng từ là fact riêng. Khớp đối tượng xe chỉ bằng hãng + model + năm + màu → liên kết `PARTIAL`. Báo giá của **các bên bán khác nhau** là các `PurchaseDeal` cạnh tranh, không phải mâu thuẫn. Cạnh `FUNDS` của khoản vay trỏ tới `PurchaseDeal` khi mục đích vay là mua tài sản / hàng hóa |
| **L360-G05** | **Định giá.** Mỗi chứng thư (số chứng thư) là một `Valuation` của `asset_id`; hai bản chụp cùng số chứng thư là một. `Valuation` hết hạn (ngày định giá + thời hạn hiệu lực < ngày nộp hồ sơ) → cờ `VALUATION_EXPIRED`. Định giá nội bộ và bên ngoài lệch quá ngưỡng chính sách → cờ `VALUATION_GAP`. Giá trị dùng cho LTV theo chính sách (OQ-360-16) |
| **L360-G06** | **Địa chỉ.** So sánh sau ánh xạ địa danh 2025; thiếu bảng ánh xạ thì chỉ `full_text` trùng mới là cùng, còn lại `NOT_COMPARABLE` (không `DISPUTED`). `Address` nối với người (thường trú, tạm trú), tài sản (thửa đất), đơn vị kinh doanh (địa điểm) để rule đọc được "nơi kinh doanh trùng TSBĐ", "tài sản ngoài địa bàn" |
| **L360-G07** | **Hộ gia đình.** Chỉ dựng từ `residence_confirmation`; quan hệ với chủ hộ giữ nguyên văn và phân loại bằng bảng của S3-R20. CT07 có được tính là căn cứ xác minh `RELATIVE_OF` hay không: OQ-360-17; v1 chỉ làm căn cứ bổ sung, không đổi `verified_count` |
| **L360-G08** | **Giấy tờ định danh.** Mỗi giấy một `IdentityDocument` với loại, số, ngày cấp, ngày hết hạn, nguồn; hết hạn tại ngày nộp hồ sơ → cờ `ID_DOCUMENT_EXPIRED`. QR / VNeID là nguồn ưu tiên khi so với ảnh OCR cùng số (giá trị lệch → fact của ảnh OCR `PROBABLE_OCR_ERROR`, không `DISPUTED`) |
| **L360-G09** | **Đối tác.** Không gộp chỉ bằng tên người (cá nhân); pháp nhân gộp theo mã số thuế, rồi tên pháp nhân `EXACT`. Đối tác khớp một người trong registry → không tạo `Counterparty`, dùng `person_id` (là đầu vào của `RELATED_COUNTERPARTY`, L360-B05) |
| **L360-G10** | PII như L360-R09 và L360-B07: cờ và số đếm, không giá trị, trong log / `content_preview`. `merge_policies.json` chỉ chứa tham số chính sách, commit được |

## 4. Duyệt mâu thuẫn của CO

### 4.1 Rule

| ID | Rule |
|---|---|
| **L360-R01** | Mỗi conflict của LAC có `conflict_key = sha256(subject_id ␀ field ␀ value_norm đã sắp xếp của mọi lựa chọn)`. Không dùng `fact-n` / `F<n>` làm khóa vì chúng đổi mỗi lần dựng |
| **L360-R02** | CO chỉ **chọn một trong các giá trị đã đọc** (cùng tinh thần MD-R16: không nhập giá trị mới), hoặc để **chưa quyết**. Bắt buộc có `reason` (≤ 500 ký tự). Nhập giá trị tay: OQ-360-02 |
| **L360-R03** | Quyết định lưu `{operation_id, conflict_key, chosen_option_key, reason, decided_by_user_id, decided_at}`. `chosen_option_key` là băm của giá trị chuẩn hóa, **không lưu giá trị** (PII đã nằm ở evidence, không nhân bản) |
| **L360-R04** | Fact được chọn có `trust = CO_RESOLVED`; fact còn lại của conflict có `trust = CO_REJECTED`: không render, không vào tính toán, vẫn nằm trong `facts` để audit. Conflict biến khỏi `conflicts` và tăng `meta.co_resolved` |
| **L360-R05** | `CO_RESOLVED` được phép `PASS` (rào LAC-R13 không chặn). Conflict chưa quyết vẫn chặn `PASS` như `DISPUTED` hiện nay |
| **L360-R06** | Quyết định chỉ có hiệu lực khi `conflict_key` còn khớp. OCR chạy lại làm giá trị hoặc nguồn đổi → khóa đổi → conflict mở lại; hệ thống không áp quyết định cũ lên dữ liệu mới |
| **L360-R07** | LLM chỉ **gợi ý** cho CO (nếu có) và không bao giờ tự áp quyết định |
| **L360-R08** | Quyền: capability mới `loan_appraisal:resolve_conflict` trong `lib/rbac/capabilities.ts` (nhóm configurable, mặc định OPS không có; ADMIN luôn có). Theo D-14, CO không phải role hệ thống. Guard ở server (`requireCapability`); UI chỉ ẩn nút. Ghi quyết định là `POST`; `GET` chỉ đọc (SECURITY-RULES #2, #3) |
| **L360-R09** | Không log giá trị, không đưa giá trị vào `content_preview` / warning (LAC-R19, S3-R26). Log chỉ nêu `conflict_key` rút gọn và số đếm |

### 4.2 Tính lại

| ID | Rule |
|---|---|
| **L360-R10** | **Tính lại tạo Operation mới** (`derived_from_operation_id`), không sửa Operation đã hoàn tất. Kết quả gốc bất biến để audit; Operation mới ghi `resolutions_hash` |
| **L360-R11** | Tính lại bắt đầu từ stage 2 trên `documents.evidences` và `customer_360` đã lưu; **không gọi lại OCR (S2) và không dựng lại S3**. Stage 2 (tài chính) đọc lớp 2 đã áp quyết định |
| **L360-R12** | Stage 3 chạy lại rule engine (rẻ). Rule LLM chỉ chạy lại cho rule có `input` chạm tới conflict đã quyết; rule khác dùng lại kết quả của Operation gốc (sau khi đối chiếu `source_hash` của LAC). Phương án đơn giản hơn là chạy lại toàn bộ: OQ-360-03 |
| **L360-R13** | Endpoint `resume` hiện có chỉ nhận `WAITING_USER_INPUT`, không dùng cho việc này. Cần endpoint riêng cho Operation `DONE` |

## 5. Acceptance criteria

| # | Tiêu chí |
|---|---|
| AC-1 | Không có quyết định nào: lớp 2 và kết quả tài chính **giống hệt** `financial-inputs.ts` hiện tại trên mọi fixture (hồi quy, không đổi số) |
| AC-2 | CO chọn giá trị A của một conflict số tiền → DSCR/LTV tính lại bằng A; Operation gốc không đổi |
| AC-3 | Fact `DISPUTED` chưa quyết luôn nằm trong một conflict; không có fact `DISPUTED` mồ côi (property test, T-360-01) |
| AC-4 | Đổi giá trị OCR của một lựa chọn → `conflict_key` đổi → quyết định cũ không áp, conflict mở lại |
| AC-5 | Người không có capability gọi API ghi quyết định → 403; `GET` không đổi trạng thái |
| AC-6 | Không giá trị fact nào trong log, bảng quyết định, `content_preview` (quét theo giá trị fixture) |
| AC-7 | Hai quyết định cho cùng `conflict_key` trên cùng Operation: bản mới thay bản cũ, bản cũ vẫn lưu lịch sử |
| AC-8 | Đơn vay + GCN ĐKHKD + bảng kê cùng một HKD (cùng số GCN, chủ cùng CCCD) → **một** `BusinessUnit`, một cạnh `OPERATES` `VERIFIED`. Hai số GCN khác nhau → conflict `DISPUTED` |
| AC-9 | Vợ và chồng mỗi người một GCN ĐKHKD → hai `BusinessUnit`, mỗi đơn vị một chủ; không có `business-1` gộp chung |
| AC-10 | Bảng kê có 3 nguồn thu lương 20tr, cho thuê 5tr, khác 5tr → 3 `IncomeStream`, tổng 30tr (hồi quy lỗi gộp dòng của LAC) |
| AC-11 | Bên bán trên `goods_purchase_contract` có CCCD trùng vợ/chồng khách vay → cờ `RELATED_COUNTERPARTY`; chỉ trùng tên → `REVIEW` |
| AC-12 | Hai đơn vị cùng tên, khác mã số thuế → không gom (L360-B01) |
| AC-13 | Hồ sơ SME: khách vay là party `ORGANIZATION`; `legal_id_card` chấm trên người đại diện, không chấm trên pháp nhân (L360-B09) |
| AC-14 | Hồ sơ SME không có người đại diện khớp bằng CCCD → gap `LEGAL_REP_NOT_VERIFIED` (L360-B10) |
| AC-15 | Tờ khai GTGT và BCKQKD cùng mã số thuế khách vay → hai fact doanh thu nối `FILED_BY` tới cùng đơn vị; khác mã số thuế → không nối, gap (L360-B11) |
| AC-16 | CIC và HĐ tín dụng cùng tổ chức, cùng người vay, cùng số tiền gốc → một `Obligation`; DSCR trừ khoản trả nợ một lần (L360-G02) |
| AC-17 | Đơn vay khai `has_existing_debt = false`, HĐ tín dụng tại TCTD khác còn hạn → cờ `UNDECLARED_DEBT` (L360-G02) |
| AC-18 | Lương cùng chủ lao động trên HĐ lao động, xác nhận lương và bảng kê → một `IncomeStream`, cộng một lần; có sao kê lương → `evidenced = true`, số tiền không đổi (L360-G03) |
| AC-19 | Báo giá và HĐ mua xe cùng bên bán, cùng hãng / model / năm / màu, không có số khung → một `PurchaseDeal`, liên kết `PARTIAL`; báo giá của bên bán khác → `PurchaseDeal` riêng, không mâu thuẫn (L360-G04) |
| AC-20 | Hai bản chụp cùng số chứng thư → một `Valuation`; chứng thư quá hạn tại ngày nộp → `VALUATION_EXPIRED` (L360-G05) |
| AC-21 | Địa chỉ thửa đất ghi tên huyện / tỉnh cũ, CCCD ghi theo đơn vị hành chính mới, không có bảng ánh xạ → `NOT_COMPARABLE`, không `DISPUTED` (L360-G06) |
| AC-22 | CT07 có chủ hộ và hai thành viên đã gom trong registry → một `Household`, hai cạnh `HOUSEHOLD_MEMBER_OF`; `verified_count` của `RELATIVE_OF` không đổi (L360-G07) |
| AC-23 | QR và ảnh CCCD cùng số, ngày sinh đọc khác nhau → fact ngày sinh của ảnh là `PROBABLE_OCR_ERROR`, giá trị QR được chọn (L360-G08) |
| AC-24 | Bên bán là cá nhân trùng tên một người trong registry nhưng khác số CCCD → không dùng `person_id` đó, tạo `Counterparty` riêng (L360-G09) |

## 6. Task cards

### T-360-01 — Nền: bất biến và hàm trust thuần
- Files: `lib/loan-dossier/context/trust.ts` (tách khỏi `build.ts`), `tests/loan-dossier/context-properties.test.ts` (fast-check, đã có trong devDependencies)
- Làm: tách tính trust thành hàm thuần nhận (nguồn còn hiệu lực, trạng thái sổ Claim, nguồn của bên đối lập); property test cho các bất biến: không fact `DISPUTED` mồ côi, `DECLARED` không bị nâng, không thẻ `untrusted_*` thoát khối, mọi `F<n>` có trong `refIndex`, lossless, ngân sách.
- DoD: AC-3. Bất biến ngân sách (text ≤ 18.000 ký tự) nhiều khả năng fail ở lần chạy đầu; sửa `render.ts` theo kết quả.

### T-360-02 — Lớp 2
- Depends: T-360-01
- Files: `lib/loan-dossier/profile360/{schema,build}.ts`, `tests/loan-dossier/profile360-build.test.ts`
- Làm: schema zod cho sáu thực thể (cộng `Counterparty` của §3.1 khi làm T-360-08); `buildProfile360(lac)` thuần, tất định. Liệt kê loại chứng từ nào cấp `IncomeStream` / `Obligation` (đã thấy `income_statement`, `loan_application.financial_info`, CIC; chưa liệt kê hết).
- DoD: schema parse; mỗi trường có `fact_ids`.

### T-360-03 — Tài chính đọc lớp 2
- Depends: T-360-02
- Files: `lib/pipelines/workflows/loan-appraisal/financial-inputs.ts`, `loan-appraisal.ts`
- Làm: `financial-inputs` đọc lớp 2 thay vì evidence; bỏ logic tự chọn (`pickAnchor`, lấy phần tử đầu).
- DoD: AC-1.

### T-360-04 — Lưu và áp quyết định
- Depends: T-360-03
- Files: `drizzle/*.sql` + `lib/db/schema.ts` (bảng `co_resolutions`), `lib/loan-dossier/context/resolutions.ts`, route ghi/đọc quyết định, `lib/rbac/capabilities.ts`, `tests/...`
- Làm: L360-R01…R09; `LAC_VERSION` lên 1.1 vì thêm `trust` `CO_RESOLVED` / `CO_REJECTED` và `meta.co_resolved`; đọc `docs/SECURITY-RULES.md` trước khi viết route.
- DoD: AC-4, AC-5, AC-6, AC-7.

### T-360-05 — Tính lại
- Depends: T-360-04
- Files: route tính lại cạnh `app/api/v1/operations/[id]/`, `lib/pipelines/workflows/loan-appraisal.ts` (điểm vào từ stage 2)
- Làm: L360-R10…R13; Operation mới liên kết `derived_from_operation_id`.
- DoD: AC-2.

### T-360-06 — Giao diện CO
- Depends: T-360-04
- Files: `app/loan-appraisal-v2/...`, `components/loan-appraisal-v2/...`
- Làm: màn liệt kê conflict (lựa chọn kèm loại chứng từ và trang), chọn, nhập lý do, nút "Tính lại". Logic ra hàm thuần vì repo không có `@testing-library`/`jsdom` (D-15).

### T-360-07 — P0: Hộ kinh doanh
- Depends: T-360-02
- Files: `lib/loan-dossier/profile360/business.ts`, `lib/loan-dossier/profile360/income.ts`, `tests/loan-dossier/profile360-business.test.ts`
- Refs: §3.1, L360-B01, L360-B02, L360-B03, L360-B04, L360-B06, L360-B07, AC-8, AC-9, AC-10
- Làm: L360-B01…B04, B06, B07 cho `kind = HKD`; nguồn: `business_info` của đơn vay, GCN ĐKHKD, `income_sources[].household_business`, xác nhận địa phương; cạnh `OPERATES`, `EARNS_FROM`. LAC render `BusinessUnit` thay `business-1`.
- DoD: AC-8, AC-9, AC-10.
- Verify: `npx jest tests/loan-dossier/profile360.test.ts`

### T-360-08 — P1: Khóa mã số thuế, giao dịch, mặt bằng, nghĩa vụ
- Depends: T-360-07
- Files: `lib/loan-dossier/profile360/{business,relations}.ts`, `tests/loan-dossier/profile360-relations.test.ts`
- Refs: §3.1, L360-B01, L360-B03, L360-B05, AC-11, AC-12
- Làm: mã số thuế từ `tax_payment_receipt` và `business_info.tax_id` vào khóa L360-B01; cạnh `FILED_BY` (chỉ nối, chưa số liệu), `TRADES_WITH` + L360-B05, `LOCATED_AT`, `OWES` theo CCCD / mã số thuế.
- DoD: AC-11, AC-12.
- Verify: `npx jest tests/loan-dossier/profile360-relations.test.ts`

### T-360-09 — P2: Doanh nghiệp (SME)
- Depends: T-360-08 và trả lời OQ-360-09, OQ-360-12 (OQ-360-06, -07 đã quyết)
- Files: `lib/loan-dossier/catalog/data/{light_extraction,doc_types}.json` (gỡ ba loại BCTC / tờ khai GTGT khỏi bóc tách nhẹ), `catalog/data/doc_schemas/{vat_tax_return,balance_sheet,financial_performance_report}.schema.json` + `scripts/gen-loan-doc-schemas.mjs` (sinh `lib/loan-dossier/s2/schemas/*`), `light_extraction.json` mục `enterprise_registration_license` (thêm CCCD người đại diện; hiện chỉ có `representative_name`), `lib/loan-dossier/s2/schemas/loan_application.ts` (vai trò mới, sinh từ schema), `lib/loan-dossier/s4/*` (L360-B09), `lib/loan-dossier/profile360/business.ts`
- Refs: §3.1, L360-B08, L360-B09, L360-B10, L360-B11, AC-13, AC-14, AC-15, OQ-360-09, OQ-360-12, OQ-360-13
- Verify: `npx jest tests/loan-dossier/profile360-sme.test.ts`
- Làm: L360-B08…B11; `kind = ENTERPRISE`; cạnh `LEGAL_REP_OF` theo CCCD, `MEMBER_OF` kèm `%`, `FUNDS`; `FILED_BY` có số liệu. Stage 2 của SME đọc chỉ tiêu BCTC thay `income_statement` (cách tính DSCR SME: OQ-360-13).
- DoD: AC-13…AC-15; AC khác viết sau khi BA chốt danh mục `sme_secured`.

### T-360-10 — Catalog chính sách chọn giá trị
- Depends: T-360-02
- Files: `lib/loan-dossier/catalog/data/merge_policies.json`, `docs/loan-appraisal/spec-v3/03_catalogs/merge_policies.json`, `lib/loan-dossier/profile360/policies.ts`, `tests/loan-dossier/profile360-policies.test.ts`
- Refs: §3.2, L360-G01, L360-G10, OQ-360-15, OQ-360-16
- Làm: schema zod cho `merge_policies.json` (`policy_id`, phiên bản, cách chọn số tiền thu nhập, cách chọn định giá cho LTV, dung sai khớp số tiền nợ, ngưỡng `VALUATION_GAP`); catalog hỏng → không chọn giá trị, gap, không đoán.
- DoD:
  - test: file mẫu qua schema; thiếu `policy_id` hoặc phiên bản → bị từ chối
  - test: catalog hỏng → giá trị để trống kèm gap, không throw
- Verify: `npx jest tests/loan-dossier/profile360.test.ts`

### T-360-11 — P1: Nghĩa vụ nợ
- Depends: T-360-10
- Files: `lib/loan-dossier/profile360/obligations.ts`, `lib/pipelines/workflows/loan-appraisal/financial-inputs.ts`, `tests/loan-dossier/profile360-obligations.test.ts`
- Refs: §3.2, L360-G02, AC-16, AC-17, OQ-360-14, OQ-360-18
- Làm: L360-G02; v1 gộp `credit_contract` với lời khai đơn vay; khoản CIC gộp được khi OQ-360-14 có bóc tách theo khoản, trước đó CIC chỉ cho cờ `ADVERSE_DEBT_GROUP`.
- DoD:
  - test: AC-16, AC-17
  - test: `current_debt_group = 3` → `ADVERSE_DEBT_GROUP`
  - test: DSCR trên fixture hiện có không đổi khi không có chứng từ nợ (AC-1)
- Verify: `npx jest tests/loan-dossier/profile360-obligations.test.ts`

### T-360-12 — P1: Nguồn thu
- Depends: T-360-07, T-360-10
- Files: `lib/loan-dossier/profile360/income.ts`, `lib/pipelines/workflows/loan-appraisal/financial-inputs.ts`, `tests/loan-dossier/profile360-income.test.ts`
- Refs: §3.2, L360-G03, L360-B04, AC-10, AC-18, OQ-360-15
- Làm: L360-G03 cho lương và cho thuê (kinh doanh đã có ở T-360-07); `evidenced` từ chứng từ bóc tách nhẹ.
- DoD:
  - test: AC-10, AC-18
  - test: lương ở hai chủ lao động khác nhau → hai luồng
  - test: thu nhập cho thuê nối đúng `asset_id`
- Verify: `npx jest tests/loan-dossier/profile360.test.ts`

### T-360-13 — P2: Giao dịch mua
- Depends: T-360-18
- Files: `lib/loan-dossier/profile360/deals.ts`, `tests/loan-dossier/profile360-deals.test.ts`
- Refs: §3.2, L360-G04, AC-19, S3-R14
- Làm: L360-G04; cạnh `FUNDS` khoản vay → `PurchaseDeal` theo `loan_purpose_categories`.
- DoD:
  - test: AC-19
  - test: HĐ mua xe có số khung trùng `asset_registry` → `PurchaseDeal` nối `asset_id`
  - test: `asset_registry` của S3 không đổi
- Verify: `npx jest tests/loan-dossier/profile360-deals.test.ts`

### T-360-14 — P2: Định giá
- Depends: T-360-10
- Files: `lib/loan-dossier/profile360/valuations.ts`, `lib/pipelines/workflows/loan-appraisal/financial-inputs.ts`, `tests/loan-dossier/profile360-valuations.test.ts`
- Refs: §3.2, L360-G05, AC-20, OQ-360-16
- Làm: L360-G05; LTV đọc giá trị `Valuation` đã chọn theo chính sách.
- DoD:
  - test: AC-20
  - test: định giá nội bộ và bên ngoài lệch quá ngưỡng → `VALUATION_GAP`
  - test: LTV trên fixture hiện có không đổi khi chỉ có một chứng thư (AC-1)
- Verify: `npx jest tests/loan-dossier/profile360-valuations.test.ts`

### T-360-15 — P3: Địa chỉ
- Depends: T-360-02 và trả lời OQ-FS-04
- Files: `lib/loan-dossier/common/address.ts`, `lib/loan-dossier/catalog/data/admin_units_2025.json` (khi có), `lib/loan-dossier/profile360/addresses.ts`, `tests/loan-dossier/profile360-addresses.test.ts`
- Refs: §3.2, L360-G06, AC-21
- Làm: chuẩn hóa địa chỉ, ánh xạ địa danh 2025 nếu có bảng; nối `Address` với người, tài sản, đơn vị kinh doanh.
- DoD:
  - test: AC-21
  - test: cùng địa chỉ viết tắt / không dấu → cùng `Address`
- Verify: `npx jest tests/loan-dossier/profile360-addresses.test.ts`

### T-360-16 — P3: Hộ gia đình
- Depends: T-360-15
- Files: `lib/loan-dossier/profile360/household.ts`, `tests/loan-dossier/profile360-household.test.ts`
- Refs: §3.2, L360-G07, AC-22, S3-R20, OQ-360-17
- Làm: L360-G07.
- DoD:
  - test: AC-22
  - test: thành viên CT07 chưa gom trong registry → không tạo người mới, ghi số đếm thành viên chưa gắn
- Verify: `npx jest tests/loan-dossier/profile360-household.test.ts`

### T-360-17 — P3: Giấy tờ định danh
- Depends: T-360-02
- Files: `lib/loan-dossier/profile360/identity-docs.ts`, `tests/loan-dossier/profile360-identity-docs.test.ts`
- Refs: §3.2, L360-G08, AC-23, S3-R12
- Làm: L360-G08; không đổi `current_id_number` của S3.
- DoD:
  - test: AC-23
  - test: CCCD hết hạn tại ngày nộp → `ID_DOCUMENT_EXPIRED`
  - test: hai bản chụp cùng số, cùng ngày cấp → một `IdentityDocument`
- Verify: `npx jest tests/loan-dossier/profile360-identity-docs.test.ts`

### T-360-18 — P3: Đối tác
- Depends: T-360-08
- Files: `lib/loan-dossier/profile360/counterparties.ts`, `tests/loan-dossier/profile360-counterparties.test.ts`
- Refs: §3.2, L360-G09, L360-B05, AC-24
- Làm: L360-G09; vai cộng dồn; `TRADES_WITH` (T-360-08) đọc `Counterparty` từ đây.
- DoD:
  - test: AC-24
  - test: cùng mã số thuế trên báo giá và HĐ mua → một `Counterparty`, hai vai
- Verify: `npx jest tests/loan-dossier/profile360-counterparties.test.ts`

## 7. Cập nhật spec LAC khi cài đặt

AC-3 / LAC-R03 đã sửa theo D-112 (hai bản đơn vay giống nhau là `DECLARED`; xác nhận độc lập cần ≥ 2 loại chứng từ). OQ-LAC-02 (nhiều hộ kinh doanh, §3.1) và OQ-LAC-03 (stage tài chính đọc LAC) được trả lời bởi tài liệu này. LAC-R03 bỏ `business-1`
khi T-360-07 cài xong; `LacSubjectKind` thêm chủ thể `business` theo `biz-n`, quan hệ thêm các cạnh ở §3.1.

## 8. Điều chưa kiểm chứng

- Chưa đọc hết cấu trúc `income_statement`, CIC và các chứng từ nợ; danh sách thực thể ở §3 có thể thiếu.
- `FieldEdit` / cổng rà soát OCR của D-04 chưa có trong code. Nếu sau này cài, quyết định của CO và bản vá OCR phải thống nhất cách chồng lên evidence để không có hai cơ chế sửa dữ liệu.
- Chưa đo chi phí chạy lại stage 3 (rule LLM); L360-R12 là tối ưu tùy chọn.
- §3.1 rút ra từ code và catalog, chưa kiểm trên hồ sơ UAT: chưa biết số GCN ĐKHKD và mã số thuế đọc được tốt đến đâu, mà đó là điều
  quyết định khóa nào của L360-B01 dùng được. Cần đo tỷ lệ đọc được hai trường này trước khi cài T-360-07.
- GCN ĐKDN hiện không bóc số CCCD của người đại diện, nên `LEGAL_REP_OF` chỉ đạt `PARTIAL` cho tới khi có T-360-09.
- Chưa kiểm mẫu đơn vay hiện tại (`loan_application`, mẫu HKD) bóc được party `BORROWER` là pháp nhân hay không: `pickAnchor`
  (S3) chỉ cần party `BORROWER` có tên, nhưng chưa có fixture SME nào chạy qua S3 / S4. Stage 2 (`financial-inputs.ts`) hiện chỉ đọc
  `income_statement` / đơn vay, chưa có nhánh SME.
- §3.2 đọc từ schema S2, chưa kiểm trên UAT: chưa biết tỷ lệ đọc được `institution` trên CIC, `contract_number` trên HĐ tín dụng,
  hãng / model / năm trên báo giá xe — đó là khóa gộp của nhóm 1 và 3. `payroll_bank_statement`, `vssid_social_insurance`,
  `asset_lease_contract`, `rental_payment_receipt`, `passport` đang bóc tách nhẹ nên chưa có số tiền hay số giấy để gộp.

## 9. Điểm cần quyết

| ID | Câu hỏi | Mặc định đề xuất | Ai quyết |
|---|---|---|---|
| **OQ-360-01** | Nhóm chứng từ nào vào `IncomeStream` / `Obligation` ở v1 | **Đã quyết (D-112):** Theo bảng §3.2 (nhóm 1, 2): thêm `credit_contract`, `labor_contract`, `salary_confirmation`; chứng từ bóc tách nhẹ chỉ chứng minh có nguồn thu | BA |
| **OQ-360-02** | CO có được nhập giá trị tay ngoài các lựa chọn đã đọc không | **Đã quyết (D-112):** Không ở v1 | BA + Risk |
| **OQ-360-03** | Tính lại chạy lại toàn bộ rule LLM hay chỉ rule chạm conflict | **Đã quyết (D-112):** Toàn bộ ở v1 (đơn giản, tốn chi phí model); tối ưu sau khi đo | Dev lead |
| **OQ-360-04** | Một conflict nhiều CO cùng quyết: bản cuối thắng hay cần hai người (maker-checker) | **Đã quyết (D-112):** Bản cuối thắng, có lịch sử | Risk |
| **OQ-360-05** | Quyết định của CO có xuất trong payload tích hợp 5.x cho hệ thống ngoài không | **Đã quyết (D-112):** Không ở v1 | PO |
| **OQ-360-06** | Khách vay SME là pháp nhân (DN đứng tên vay, chủ DN bảo lãnh) hay cá nhân chủ DN vay cho DN | **Đã quyết (2026-10-27): pháp nhân** — khách vay là doanh nghiệp, không phải cá nhân chủ DN → L360-B08…B10 | BA |
| **OQ-360-07** | Có bóc tách đầy đủ số liệu `vat_tax_return`, `balance_sheet`, `financial_performance_report` (doanh thu, lợi nhuận, nợ) thay bóc tách nhẹ không | **Đã quyết (2026-10-27): có** → L360-B11; danh sách trường: OQ-360-12 | BA |
| **OQ-360-08** | Mục checklist HKD / DN chấm theo từng đơn vị kinh doanh (mỗi HKD đủ bộ) hay giữ `DOSSIER` (có một bộ là đủ) | **Đã quyết (2026-10-27): theo cả hồ sơ** (`DOSSIER`) → L360-B06 | BA |
| **OQ-360-09** | Đơn vay SME thêm vai trò nào: người đại diện theo pháp luật, người bảo lãnh, thành viên góp vốn; mẫu đơn vay SME có khác mẫu HKD không | **Đã quyết (D-112):** dùng chung `loan_application`, `BORROWER` là `ORGANIZATION`; thêm vai trò `LEGAL_REPRESENTATIVE`, `GUARANTOR`, `CAPITAL_MEMBER` | BA |
| **OQ-360-10** | Bên bán là người liên quan (`RELATED_COUNTERPARTY`) thì chỉ cảnh báo hay hạ kết quả rule | **Đã quyết (D-112):** Chỉ cảnh báo ở v1 (L360-B05) | Risk |
| **OQ-360-11** | Một khách vay có nhiều HKD: thu nhập tính gộp mọi HKD hay chỉ HKD được tài trợ (`FUNDS`) | **Đã quyết (D-112):** Gộp mọi HKD có chứng từ | BA + Risk |
| **OQ-360-12** | Danh sách trường bóc tách đầy đủ của tờ khai GTGT, bảng cân đối kế toán, BCKQKD (bảng đề xuất ở §3.1) có đủ và đúng không; nhận BCTC chưa kiểm toán không | **Đã quyết (D-112):** Theo bảng §3.1; nhận cả chưa kiểm toán, ghi cờ | BA |
| **OQ-360-13** | DSCR / khả năng trả nợ của SME tính từ chỉ tiêu nào (lợi nhuận sau thuế + khấu hao, EBITDA…), lấy kỳ nào (năm gần nhất, bình quân) | **Đã quyết (D-112):** (lợi nhuận trước thuế + chi phí lãi vay) / nghĩa vụ trả nợ năm; năm tài chính gần nhất có BCKQKD; thiếu → `INSUFFICIENT_DATA` | BA + Risk |
| **OQ-360-14** | Bóc tách CIC theo từng khoản (tổ chức, dư nợ, nhóm nợ, ngày đến hạn, TSBĐ) thay vì `records_raw` | **Đã quyết (D-112):** Có; trước khi có, CIC chỉ cho cờ nhóm nợ (T-360-11) | BA |
| **OQ-360-15** | Một luồng thu nhập có nhiều số tiền (HĐ lao động, xác nhận lương, bảng kê): chọn số nào cho DSCR | **Đã quyết (D-112):** Số thấp nhất trong các chứng từ còn hiệu lực | Risk |
| **OQ-360-16** | Một tài sản có nhiều định giá còn hạn: giá trị nào tính LTV | **Đã quyết (D-112):** Thấp nhất giữa định giá nội bộ và bên ngoài | Risk |
| **OQ-360-17** | CT07 (cùng hộ, ghi quan hệ với chủ hộ) có được tính là căn cứ xác minh `RELATIVE_OF` thay giấy khai sinh không | **Đã quyết (D-112):** Không ở v1; chỉ căn cứ bổ sung (L360-G07) | BA + Pháp chế |
| **OQ-360-18** | Dung sai khớp số tiền gốc giữa CIC và HĐ tín dụng | **Đã quyết (D-112):** Bằng nhau sau làm tròn đến triệu đồng | BA |
