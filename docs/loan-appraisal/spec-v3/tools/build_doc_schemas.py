#!/usr/bin/env python3
"""Sinh JSON Schema cho 20 loại chứng từ `FULL` chưa có schema ở nguồn (D-33, bước C2).

Chạy (sau khi sửa định nghĩa trong file này; `03_catalogs/` là nguồn chuẩn, không còn sinh từ bộ nguồn ngoài — D-37):
    python docs/loan-appraisal/spec-v3/tools/build_doc_schemas.py
rồi `npm run sync:loan-catalogs`.

Nguồn nội dung: mô tả cũ `Specs_Sprint_1-2_20261012/.../step2_extract_evidence/*.md` (field nghiệp vụ),
catalog UAT `uat-analysis/03-field-catalog.json` (field phải có để chấm UAT), và mọi `field_path`
mà `cross_check_matrix.json` / `sl_fields.json` trỏ tới (bắt buộc tồn tại).
Quy ước kiểu (02_conventions, S2-R10): ngày ISO, tiền số nguyên VND, địa chỉ object `Address`,
người/tổ chức ở `parties[]` (`DocumentParty`), tài sản ở `assets[]` (`AssetDescriptor`) + thuộc tính
riêng ở `asset_details[]` nối bằng `asset_index`. Mọi object `additionalProperties: false`.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "03_catalogs" / "doc_schemas"
C = "_common.schema.json#/$defs/"
E = "_enums.schema.json#/$defs/"

# ── kiểu nguyên thủy ──────────────────────────────────────────────────────────
STR = {"type": ["string", "null"]}
INT = {"type": ["integer", "null"], "minimum": 0}
NUM = {"type": ["number", "null"], "minimum": 0}
BOOL = {"type": ["boolean", "null"]}
DATE = {"$ref": C + "NullableDate"}
MONEY = {"$ref": C + "NullableMoney"}
ADDR = {"$ref": C + "NullableAddress"}
PCT = {"oneOf": [{"$ref": C + "Percent"}, {"type": "null"}]}
DATETIME = {"oneOf": [{"$ref": C + "DateTimeString"}, {"type": "null"}]}
# Chỉ tiêu tài chính có thể âm (lỗ, vốn chủ âm): số nguyên VND có dấu, không dùng MoneyVND (không âm).
SIGNED = {"type": ["integer", "null"]}


def d(desc: str, base: dict) -> dict:
    return {"description": desc, **base}


def enum(values: list, desc: str | None = None) -> dict:
    o = {"enum": values + [None]}
    return {"description": desc, **o} if desc else o


def obj(props: dict, desc: str | None = None, nullable: bool = False) -> dict:
    o = {"type": ["object", "null"] if nullable else "object", "additionalProperties": False,
         "required": list(props), "properties": props}
    return {"description": desc, **o} if desc else o


def arr(items: dict, desc: str | None = None, min_items: int = 0) -> dict:
    o = {"type": "array", "items": items}
    if min_items:
        o["minItems"] = min_items
    return {"description": desc, **o} if desc else o


def ref(name: str) -> dict:
    return {"$ref": f"#/$defs/{name}"}


def party_def(roles: list[str], ownership: bool = False, extra: dict | None = None) -> dict:
    props = {"party_role": {"enum": roles}}
    if not ownership:
        props["ownership"] = {"type": "null"}
    props.update(extra or {})
    return {"allOf": [{"$ref": C + "DocumentParty"}, {"properties": props}]}


def asset_def(types: list[str], hint=None) -> dict:
    return {"allOf": [{"$ref": C + "AssetDescriptor"},
                      {"properties": {"asset_type": {"enum": types}, "usage_context_hint": {"const": hint}}}]}


ITEM = obj({
    "item_no": INT, "item_name": STR, "unit": STR, "quantity": NUM,
    "unit_price": MONEY, "amount": MONEY,
})

GCN_ASSET_DETAIL = obj({
    "asset_index": {"type": "integer", "minimum": 0},
    "land_area_m2": d("Diện tích thửa đất (m²).", NUM),
    "land_use_purpose": d("Mục đích sử dụng đất (nguyên văn).", STR),
    "land_use_term_raw": d("Thời hạn sử dụng (nguyên văn, VD 'Lâu dài').", STR),
    "land_use_origin": d("Nguồn gốc sử dụng (nguyên văn).", STR),
    "house_type": d("Loại nhà ở / tài sản gắn liền (mục 2.a).", STR),
    "construction_area_m2": d("Diện tích xây dựng (m²).", NUM),
    "floor_area_m2": d("Diện tích sàn / diện tích sử dụng căn hộ (m²).", NUM),
    "number_of_floors": INT,
    "floor": d("Tầng của căn hộ (nguyên văn).", STR),
    "ownership_form": d("Hình thức sở hữu / sử dụng (riêng, chung…).", STR),
})

CHANGE_RECORD = obj({
    "record_index": {"type": "integer", "minimum": 0},
    "change_date": d("Ngày đăng ký biến động.", DATE),
    "change_type": {"oneOf": [{"$ref": E + "OwnershipChangeType"}, {"type": "null"}]},
    "content_raw": d("Nội dung biến động (nguyên văn).", STR),
    "party_indexes": arr({"type": "integer", "minimum": 0}, "party_index của người nhận quyền ở biến động này."),
})

VEHICLE_DETAIL_BASE = {
    "asset_index": {"type": "integer", "minimum": 0},
    "vehicle_brand": d("Nhãn hiệu (VD 'KIA').", STR),
    "vehicle_model": d("Số loại / model (VD 'CARENS').", STR),
    "vehicle_type": d("Loại phương tiện (nguyên văn).", STR),
    "manufacture_year": d("Năm sản xuất.", {"type": ["integer", "null"], "minimum": 1900, "maximum": 2100}),
    "color": STR,
}

VALUATION_DETAIL = obj({
    "asset_index": {"type": "integer", "minimum": 0},
    "land_area_m2": d("Diện tích đất được định giá (m²).", NUM),
    "land_use_status": d("Hiện trạng thửa đất / tài sản (nguyên văn).", STR),
    "land_value": d("Giá trị quyền sử dụng đất (VND).", MONEY),
    "construction_value": d("Giá trị công trình xây dựng (VND).", MONEY),
    "valuation_value": d("Tổng giá trị định giá của tài sản này (VND).", MONEY),
    "asset_grade": d("Hạng / xếp loại tài sản (nguyên văn).", STR),
})

GCN_REQUIRED_NOTE = ("Chủ sở hữu theo S2-R13: chủ trang bìa → `ownership.ownership_source = COVER_PAGE`; người nhận quyền ở "
                     "trang biến động → `CHANGE_RECORD` kèm `ownership_change_date`; `is_current_owner` theo S2-R13. "
                     "Ô ghép nhiều chủ ('A + B', 'A và B') giữ 1 party (S2-R11), S3 tách.")


def schema(key: str, label: str, desc: str, props: dict, defs: dict) -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://specs.loan-appraisal-hkd/v3/documents/{key}.schema.json",
        "title": f"{key} — data",
        "description": f"Schema của evidence.data cho doc_type_key = {key} ({label}). {desc} schema_version 3.0.0. Sinh bởi tools/build_doc_schemas.py — không sửa tay.",
        "type": "object",
        "additionalProperties": False,
        "required": list(props),
        "properties": props,
        "$defs": defs,
    }


LEGAL = lambda desc: d(desc, {"$ref": C + "NullableLegalInfo"})  # noqa: E731


def gcn(key: str, label: str, asset_types: list[str], extra_note: str = "") -> dict:
    return schema(key, label, "Mỗi thửa/căn là 1 phần tử `assets[]`; thuộc tính đất/nhà ở `asset_details[]`. " + extra_note, {
        "parties": arr(ref("OwnerParty"), GCN_REQUIRED_NOTE, 1),
        "assets": arr(ref("Asset"), "Thửa đất / căn hộ. `identifiers.certificate_number` = số phát hành GCN (VD 'BQ 747032'), `certificate_book_number` = số vào sổ cấp GCN.", 1),
        "asset_details": arr(GCN_ASSET_DETAIL),
        "change_records": arr(CHANGE_RECORD, "Trang 'Những thay đổi sau khi cấp giấy chứng nhận', theo thứ tự in."),
        "legal_info": LEGAL("issue_date = ngày ký cấp GCN; issuing_authority = cơ quan cấp; valid_until luôn null."),
    }, {"OwnerParty": party_def(["OWNER"], ownership=True), "Asset": asset_def(asset_types)})


def build() -> dict[str, dict]:
    s: dict[str, dict] = {}

    s["purchase_list"] = schema("purchase_list", "Bảng kê mua hàng",
        "Tiêu đề thay đổi theo đơn vị lập (BẢNG KÊ HÀNG HÓA MUA VÀO / HÀNG CẦN NHẬP / MUA HÀNG…).", {
        "parties": arr(ref("Party"), "CUSTOMER = khách hàng lập bảng kê (luôn 1 người, KH vay); SELLER nếu bảng kê ghi bên bán.", 1),
        "business_info": obj({"business_line": d("Ngành hàng / lĩnh vực kinh doanh ghi trên bảng kê.", STR),
                              "business_address": d("Địa chỉ kinh doanh ghi trên bảng kê.", ADDR)}, nullable=True),
        "funding_plan": obj({
            "total_amount": d("Tổng giá trị bảng kê (VND). UAT `total_value`.", MONEY),
            "loan_amount": d("Số tiền đề nghị vay ghi trên bảng kê, nếu có (VND).", MONEY),
            "own_capital_amount": d("Vốn tự có ghi trên bảng kê, nếu có (VND).", MONEY),
        }),
        "items": arr(ITEM, "Danh sách hàng hóa dự kiến mua bằng vốn vay."),
        "legal_info": LEGAL("issue_date = ngày lập bảng kê."),
    }, {"Party": party_def(["CUSTOMER", "SELLER"])})

    s["goods_purchase_contract"] = schema("goods_purchase_contract", "Hợp đồng mua bán hàng hóa",
        "Bên bán là doanh nghiệp: `party_type = ORGANIZATION`, mã số thuế ở `tax_id`, người đại diện ở `representative_name`; là cá nhân: số CCCD ở `id_number`.", {
        "parties": arr(ref("Party"), "SELLER (bên bán hàng hóa / thi công) và BUYER (thường là khách hàng vay; `current_address` = địa chỉ bên mua).", 2),
        "contract_info": obj({
            "contract_number": STR, "sign_date": DATE,
            "total_amount": d("Tổng giá trị hợp đồng (VND). UAT `total_value`.", MONEY),
            "payment_terms_raw": STR, "delivery_terms_raw": STR,
        }),
        "goods_summary": obj({"goods_description": d("Mô tả chung hàng hóa / công trình (nguyên văn).", STR),
                              "items": arr(ITEM)}),
        "legal_info": LEGAL("document_number = số hợp đồng; issue_date = ngày ký."),
    }, {"Party": party_def(["SELLER", "BUYER"])})

    s["vehicle_sale_contract"] = schema("vehicle_sale_contract", "Hợp đồng mua bán xe ô tô",
        "Xe mua bán là `assets[]` loại `vehicle`; xe mới chưa đăng ký → `license_plate = null`.", {
        "parties": arr(ref("Party"), "SELLER (đại lý / cá nhân bán) và BUYER (thường là khách hàng vay).", 2),
        "assets": arr(ref("Asset"), None, 1),
        "asset_details": arr(obj({**VEHICLE_DETAIL_BASE,
                                  "vehicle_name": d("Tên xe ghi trên hợp đồng (nguyên văn).", STR),
                                  "unit_price": d("Đơn giá xe (VND).", MONEY)})),
        "contract_info": obj({"contract_number": STR, "sign_date": DATE,
                              "total_amount": d("Tổng giá trị hợp đồng (VND). UAT `total_value`.", MONEY),
                              "payment_terms_raw": STR}),
        "legal_info": LEGAL("document_number = số hợp đồng; issue_date = ngày ký."),
    }, {"Party": party_def(["SELLER", "BUYER"]), "Asset": asset_def(["vehicle"])})

    s["land_use_cert_to_buy"] = gcn("land_use_cert_to_buy", "GCN QSDĐ cần mua / đã sang tên KH (làm nhà xưởng)",
                                    ["real_estate"], "Ô gộp 'Tờ bản đồ số / Địa chỉ' tách thành `map_sheet_number` và `address`.")
    s["land_use_certificate"] = gcn("land_use_certificate", "GCN QSDĐ, quyền sở hữu nhà ở và tài sản gắn liền với đất",
                                    ["real_estate"], "Địa chỉ thửa đất giữ địa danh như in (thường là địa danh cũ), không đổi sang địa danh mới.")
    s["apartment_ownership_certificate"] = gcn("apartment_ownership_certificate", "GCN quyền sở hữu căn hộ chung cư",
                                               ["apartment"], "`identifiers.apartment_number`, `building_name` = căn hộ số, tên nhà chung cư (mục 2.a).")

    s["vehicle_registration"] = schema("vehicle_registration", "Chứng nhận đăng ký xe ô tô",
        "Chủ xe theo S2-R13 (chỉ trang bìa → `COVER_PAGE`, `is_current_owner = true`).", {
        "parties": arr(ref("OwnerParty"), "Chủ xe (OWNER).", 1),
        "assets": arr(ref("Asset"), "`identifiers.registration_number` = số đăng ký (ô 'Số / Number'); `license_plate` giữ như in (VD '86A-364.34').", 1),
        "asset_details": arr(obj({**VEHICLE_DETAIL_BASE,
                                  "seats": INT, "engine_capacity_raw": STR,
                                  "first_registration_date": d("Ngày đăng ký lần đầu.", DATE)})),
        "legal_info": LEGAL("issue_date = ngày cấp đăng ký; valid_until = hạn đăng ký nếu in (xe kinh doanh)."),
    }, {"OwnerParty": party_def(["OWNER"], ownership=True), "Asset": asset_def(["vehicle"])})

    s["vehicle_inspection"] = schema("vehicle_inspection", "Giấy chứng nhận đăng kiểm xe",
        "Không xác định chủ sở hữu hiện tại (S2-R13 không áp dụng): party OWNER có `ownership = null`. Hạn kiểm định ở `legal_info.valid_until` nhưng S4 không kiểm (`ignore_printed_expiry`).", {
        "parties": arr(ref("Party"), "Chủ xe in trên giấy (OWNER).", 0),
        "assets": arr(ref("Asset"), "`identifiers.registration_number` = số đăng ký xe nếu giấy có in; KHÔNG ghi số quản lý hay số seri vào đây.", 1),
        "asset_details": arr(obj({**VEHICLE_DETAIL_BASE,
                                  "country_of_manufacture": STR,
                                  "modification_status_raw": d("Tình trạng cải tạo (nguyên văn, VD 'Có cải tạo').", STR),
                                  "seats": INT, "payload_kg": NUM, "gross_weight_kg": NUM})),
        "inspection_info": obj({
            "inspection_number": d("Số chứng nhận kiểm định / số seri (VD 'VA 3533404'). UAT `inspection_no`.", STR),
            "management_number": d("Số quản lý phương tiện (VD '3603D-019912').", STR),
            "inspection_date": d("Ngày kiểm định.", DATE),
        }),
        "legal_info": LEGAL("document_number = số chứng nhận kiểm định; issue_date = ngày cấp; valid_until = hạn kiểm định."),
    }, {"Party": party_def(["OWNER"]), "Asset": asset_def(["vehicle"])})

    s["asset_quote"] = schema("asset_quote", "Báo giá tài sản",
        "Hiệu lực 90 ngày tính từ `legal_info.issue_date` (S4-R15).", {
        "parties": arr(ref("Party"), "CUSTOMER = khách hàng được báo giá; OWNER nếu báo giá ghi chủ tài sản.", 1),
        "assets": arr(ref("Asset"), None, 1),
        "asset_details": arr(obj({**VEHICLE_DETAIL_BASE,
                                  "asset_name": d("Tên tài sản được báo giá (nguyên văn).", STR),
                                  "quantity": NUM,
                                  "quoted_value": d("Giá trị báo giá của tài sản (VND). UAT `asset_value`.", MONEY)})),
        "quote_info": obj({"quoting_company": d("Đơn vị báo giá.", STR), "quote_number": STR,
                           "total_quoted_value": d("Tổng giá trị báo giá (VND).", MONEY)}),
        "legal_info": LEGAL("issue_date = ngày báo giá (căn cứ hiệu lực)."),
    }, {"Party": party_def(["CUSTOMER", "OWNER"]), "Asset": asset_def(["vehicle", "other"])})

    s["movable_asset_valuation_report"] = schema("movable_asset_valuation_report", "Báo cáo định giá động sản",
        "Hiệu lực 365 ngày tính từ `legal_info.issue_date` (S4-R15).", {
        "parties": arr(ref("Party"), "CUSTOMER = khách hàng vay vốn; OWNER = chủ tài sản nếu in.", 1),
        "assets": arr(ref("Asset"), None, 1),
        "asset_details": arr(obj({**VEHICLE_DETAIL_BASE,
                                  "asset_condition_raw": d("Tình trạng tài sản (nguyên văn).", STR),
                                  "valuation_value": d("Giá trị định giá (VND). UAT `asset_value`.", MONEY)})),
        "valuation_info": obj({"valuation_date": DATE, "valuation_purpose": STR, "valuation_method_raw": STR,
                               "total_valuation_value": d("Tổng giá trị định giá (VND).", MONEY)}),
        "legal_info": LEGAL("issue_date = ngày lập báo cáo (căn cứ hiệu lực)."),
    }, {"Party": party_def(["CUSTOMER", "OWNER"]), "Asset": asset_def(["vehicle", "other"])})

    valuation_props = lambda company, variant_desc: {  # noqa: E731
        "parties": arr(ref("Party"), "CUSTOMER = khách hàng vay / khách hàng yêu cầu định giá; OWNER = chủ tài sản nếu in.", 1),
        "assets": arr(ref("Asset"), None, 1),
        "asset_details": arr(VALUATION_DETAIL),
        "valuation_info": obj({
            "appraisal_company": company,
            "form_variant": variant_desc,
            "valuation_certificate_number": d("Số chứng thư / số báo cáo.", STR),
            "valuation_date": DATE, "valuation_purpose": STR,
            "collateral_info_text": d("Khối 'Thông tin TSBĐ' (nguyên văn). UAT `collateral_info`.", STR),
            "validity_period_raw": d("Câu thời hạn hiệu lực (nguyên văn).", STR),
            "total_valuation_value": d("Tổng giá trị định giá (VND).", MONEY),
        }),
        "legal_info": LEGAL("issue_date = ngày phát hành chứng thư / báo cáo (căn cứ hiệu lực)."),
    }
    s["real_estate_valuation_report"] = schema("real_estate_valuation_report", "Báo cáo định giá BĐS nội bộ (Thịnh Điền)",
        "Hiệu lực 365 ngày (S4-R15).",
        valuation_props({"const": "THINH_DIEN"},
                        {"$ref": E + "RealEstateValuationFormVariant"}),
        {"Party": party_def(["CUSTOMER", "OWNER"]), "Asset": asset_def(["real_estate", "apartment"])})
    s["external_valuation_certificate"] = schema("external_valuation_certificate", "Chứng thư định giá công ty định giá ngoài",
        "Gộp 4 mẫu SBA, CITICS, FARGO, VVFC; công ty ở `valuation_info.appraisal_company`. Hiệu lực 180 ngày (OQ-21).",
        valuation_props({"$ref": E + "AppraisalCompany"}, {"type": "null"}),
        {"Party": party_def(["CUSTOMER", "OWNER"]), "Asset": asset_def(["real_estate", "apartment"])})

    sub = lambda props: obj(props, nullable=True)  # noqa: E731
    s["income_statement"] = schema("income_statement", "Bảng kê thu nhập (mẫu MB01.QĐi-TDCN/41)",
        "2 cột: Khách hàng vay → party BORROWER, Người đồng vay → party CO_BORROWER (ô 'A/B' tách thành 2 party). Mỗi mục thu nhập là 1 `income_sources[]` gắn người qua `party_index`; chỉ khối con đúng `income_type` khác null.", {
        "parties": arr(ref("Party"), None, 1),
        "income_summary": obj({
            "income_source_type_raw": d("Ô 'Loại nguồn thu' (nguyên văn).", STR),
            "capital_turnover": d("Vòng quay vốn (số vòng).", NUM),
            "total_monthly_income": d("Tổng thu nhập hàng tháng (VND/tháng).", MONEY),
        }),
        "income_sources": arr(obj({
            "source_index": {"type": "integer", "minimum": 0},
            "party_index": {"type": ["integer", "null"], "minimum": 0},
            "income_type": {"enum": ["salary", "rental", "household_business", "trip_trading", "enterprise", "other"]},
            "source_label_raw": d("Nhãn mục (VD 'Lương 1 - Nguyễn Văn A').", STR),
            "monthly_amount": d("Thu nhập sau thuế của mục (VND/tháng).", MONEY),
            "frequency_raw": STR,
            "salary": sub({"employer_name": STR, "current_job_raw": STR, "position": STR,
                           "months_at_employer": INT, "workplace_address": ADDR}),
            "rental": sub({"asset_index": {"type": ["integer", "null"], "minimum": 0},
                           "asset_description_raw": STR, "owner_name": STR, "tenant_name": STR,
                           "contract_term_raw": STR}),
            "household_business": sub({
                "business_name": STR,
                "business_forms": arr({"enum": ["PHYSICAL_PREMISES", "ONLINE"]},
                                      "Ô tích hình thức kinh doanh: 'Có cơ sở kinh doanh' → PHYSICAL_PREMISES, 'Online' → ONLINE, 'Cả 2' → cả hai."),
                "business_line": STR, "operating_time_raw": STR, "actual_address": ADDR,
                "premises_type_raw": d("Mặt bằng: Thuê / Khách hàng sở hữu (nguyên văn).", STR),
                "premises_area_m2": NUM,
                "net_revenue_annual": d("Doanh thu thuần (VND/năm).", MONEY),
                "cogs_annual": d("Giá vốn hàng bán (VND/năm).", MONEY),
                "gross_profit_annual": d("Lợi nhuận gộp (VND/năm).", MONEY),
                "total_cost_annual": d("Tổng chi phí (VND/năm).", MONEY),
                "net_profit_annual": d("Lợi nhuận ròng (VND/năm).", MONEY)}),
            "trip_trading": sub({"vehicle_raw": STR, "net_profit": MONEY,
                                 "net_profit_period": {"$ref": E + "MetricPeriod"}}),
            "enterprise": sub({"enterprise_name": STR, "registration_or_tax_number": STR,
                               "capital_share_percent": PCT, "registered_address": ADDR,
                               "annual_result": d("Kết quả kinh doanh năm gần nhất (VND/năm).", MONEY),
                               "avg_monthly_profit": d("Lợi nhuận trung bình tháng (VND/tháng).", MONEY)}),
        })),
        "assets": arr(ref("RentalAsset"), "Tài sản cho thuê ở mục II.2 (`usage_context_hint = rental_income`, S2-R12)."),
        "legal_info": LEGAL("issue_date = ngày lập bảng kê."),
    }, {"Party": party_def(["BORROWER", "CO_BORROWER"]),
        "RentalAsset": asset_def(["real_estate", "apartment", "vehicle", "other"], "rental_income")})

    s["labor_contract"] = schema("labor_contract", "Hợp đồng lao động",
        "Ngày hết hạn hợp đồng dùng đánh giá ổn định nguồn lương; `sign_date` dùng cho logic rule `id_issue_date_before_labor_contract`.", {
        "parties": arr(ref("Party"), "EMPLOYER (đơn vị sử dụng lao động, ORGANIZATION; UAT `company`) và EMPLOYEE (khách hàng).", 1),
        "contract_info": obj({"contract_number": STR, "contract_type_raw": STR, "sign_date": DATE,
                              "effective_date": DATE, "expiry_date": d("Ngày hết hạn; null nếu không xác định thời hạn.", DATE),
                              "position": STR, "work_location_raw": STR,
                              "monthly_salary": d("Mức lương hàng tháng ghi trên hợp đồng (VND/tháng).", MONEY),
                              "payment_terms_raw": STR}),
        "legal_info": LEGAL("document_number = số hợp đồng; issue_date = ngày ký."),
    }, {"Party": party_def(["EMPLOYER", "EMPLOYEE"])})

    s["salary_confirmation"] = schema("salary_confirmation", "Giấy xác nhận lương",
        "1 người lao động / giấy.", {
        "parties": arr(ref("Party"), "EMPLOYER (đơn vị xác nhận) và EMPLOYEE (khách hàng).", 1),
        "salary_info": obj({"position": STR, "months_at_employer": INT,
                            "monthly_salary": d("Tổng thu nhập thực lĩnh hàng tháng (VND/tháng). UAT `net_income`.", MONEY),
                            "gross_monthly_salary": d("Lương gộp hàng tháng (VND/tháng).", MONEY),
                            "salary_period_raw": STR, "confirmation_date": DATE}),
        "legal_info": LEGAL("issue_date = ngày xác nhận."),
    }, {"Party": party_def(["EMPLOYER", "EMPLOYEE"])})

    history = obj({"has_records": d("true nếu mục có ít nhất 1 dòng; false nếu ghi 'Không có'.", BOOL),
                   "records_raw": d("Nội dung mục (nguyên văn).", STR)})
    s["cic"] = schema("cic", "Báo cáo thông tin tín dụng CIC",
        "Mẫu S11A/S11T (OQ-07). Hiệu lực 30 ngày tính từ `legal_info.issue_date` (ngày tra cứu). 1 báo cáo nhiều người → mỗi người 1 party HOLDER và 1 phần tử `reports[]`.", {
        "parties": arr(ref("Party"), "Người được tra cứu (HOLDER); tên thường in hoa không dấu, giữ như in.", 1),
        "reports": arr(obj({
            "party_index": {"type": "integer", "minimum": 0},
            "report_datetime": d("Thời gian gửi báo cáo (có giờ nếu in).", DATETIME),
            "cic_code": d("Mã CIC (10 chữ số).", STR),
            "current_debt_group": d("Nhóm nợ hiện tại 1–5; null nếu không có quan hệ tín dụng.", {"type": ["integer", "null"], "minimum": 1, "maximum": 5}),
            "current_debt_group_raw": STR,
            "bad_debt_5y": d("Mục 3.5 — lịch sử nợ xấu 5 năm.", history),
            "card_late_payment_3y": d("Mục 3.6 — chậm thanh toán thẻ 3 năm.", history),
            "watchlist_debt_12m": d("Mục 3.7 — nợ cần chú ý 12 tháng.", history),
            "queried_institutions_1y_count": INT,
            "queried_institutions": arr(obj({"institution": STR, "query_date": DATE})),
        }), None, 1),
        "legal_info": LEGAL("form_template_number = số hiệu mẫu (VD '2026/S11A'); issue_date = ngày tra cứu (căn cứ hiệu lực)."),
    }, {"Party": party_def(["HOLDER"])})

    s["credit_contract"] = schema("credit_contract", "Hợp đồng tín dụng tại TCTD khác",
        "Khoản vay hiện hữu tại tổ chức tín dụng khác (không so số tiền/mục đích/thời hạn với khoản đang đề nghị).", {
        "parties": arr(ref("Party"), "LENDER (TCTD, ORGANIZATION) và BORROWER / CO_BORROWER.", 1),
        "contract_info": obj({"contract_number": STR, "sign_date": DATE,
                              "loan_amount": d("Số tiền vay (VND).", MONEY),
                              "loan_purpose": STR,
                              "loan_term_months": INT, "loan_term_raw": STR,
                              "interest_rate": d("Lãi suất %/năm nếu in.", PCT),
                              "maturity_date": DATE}),
        "legal_info": LEGAL("document_number = số hợp đồng; issue_date = ngày ký."),
    }, {"Party": party_def(["BORROWER", "CO_BORROWER", "LENDER"])})

    # SME (L360-B11, OQ-360-07 / OQ-360-12, D-112): một doanh nghiệp / chứng từ; party chủ thể là pháp nhân, `tax_id` = mã số thuế.
    # Kỳ báo cáo đọc ra `period_from` / `period_to`; chỉ tiêu nào không in → null, không suy ra từ chỉ tiêu khác.
    org_note = "Doanh nghiệp lập (party_type = ORGANIZATION, `tax_id` = mã số thuế, `full_name` = tên doanh nghiệp)."
    s["vat_tax_return"] = schema("vat_tax_return", "Tờ khai thuế GTGT (mẫu 01/GTGT)",
        "Một kỳ tính thuế / tờ khai; tờ khai bổ sung là chứng từ riêng (`filing_type = SUPPLEMENTARY`).", {
        "parties": arr(ref("Party"), "TAXPAYER = người nộp thuế. " + org_note, 1),
        "tax_return_info": obj({
            "tax_period_raw": d("Kỳ tính thuế (nguyên văn, VD 'Quý 2 năm 2026').", STR),
            "period_type": enum(["MONTH", "QUARTER"], "Khai theo tháng hay quý."),
            "period_from": DATE, "period_to": DATE,
            "filing_type": enum(["ORIGINAL", "SUPPLEMENTARY"], "Lần đầu / bổ sung."),
            "sales_revenue": d("Doanh thu hàng hóa, dịch vụ bán ra chịu thuế + không chịu thuế (VND).", MONEY),
            "output_vat": d("Thuế GTGT của hàng hóa, dịch vụ bán ra (VND).", MONEY),
            "deductible_input_vat": d("Thuế GTGT đầu vào được khấu trừ (VND).", MONEY),
            "vat_payable": d("Thuế GTGT phải nộp trong kỳ (VND); kỳ còn được khấu trừ → 0.", MONEY),
        }),
        "legal_info": LEGAL("issue_date = ngày ký tờ khai / ngày nộp."),
    }, {"Party": party_def(["TAXPAYER"])})

    s["balance_sheet"] = schema("balance_sheet", "Bảng cân đối kế toán",
        "Số cuối kỳ (cột 'Số cuối năm' / 'Số cuối kỳ'); không lấy cột đầu kỳ.", {
        "parties": arr(ref("Party"), "HOLDER = doanh nghiệp lập báo cáo. " + org_note, 1),
        "balance_info": obj({
            "period_raw": d("Kỳ báo cáo (nguyên văn, VD 'Năm 2025').", STR),
            "report_date": d("Ngày chốt số liệu (cuối kỳ).", DATE),
            "total_assets": d("Tổng cộng tài sản (VND).", MONEY),
            "cash_and_equivalents": d("Tiền và các khoản tương đương tiền (VND).", MONEY),
            "short_term_receivables": d("Các khoản phải thu ngắn hạn (VND).", MONEY),
            "inventory": d("Hàng tồn kho (VND).", MONEY),
            "fixed_assets": d("Tài sản cố định (VND).", MONEY),
            "total_liabilities": d("Nợ phải trả (VND).", MONEY),
            "short_term_borrowings": d("Vay và nợ thuê tài chính ngắn hạn (VND).", MONEY),
            "long_term_borrowings": d("Vay và nợ thuê tài chính dài hạn (VND).", MONEY),
            "owner_equity": d("Vốn chủ sở hữu (VND, có thể âm).", SIGNED),
            "is_audited": d("Có báo cáo kiểm toán / dấu kiểm toán (OQ-360-12: nhận cả chưa kiểm toán).", BOOL),
        }),
        "legal_info": LEGAL("issue_date = ngày lập báo cáo."),
    }, {"Party": party_def(["HOLDER"])})

    s["financial_performance_report"] = schema("financial_performance_report", "Báo cáo kết quả hoạt động kinh doanh",
        "Số kỳ này (cột 'Năm nay' / 'Kỳ này'); không lấy cột kỳ trước.", {
        "parties": arr(ref("Party"), "HOLDER = doanh nghiệp lập báo cáo. " + org_note, 1),
        "performance_info": obj({
            "period_raw": d("Kỳ báo cáo (nguyên văn).", STR),
            "period_from": DATE, "period_to": DATE,
            "net_revenue": d("Doanh thu thuần về bán hàng và cung cấp dịch vụ (VND).", MONEY),
            "cogs": d("Giá vốn hàng bán (VND).", MONEY),
            "gross_profit": d("Lợi nhuận gộp (VND, có thể âm).", SIGNED),
            "interest_expense": d("Chi phí lãi vay (dòng 'Trong đó: chi phí lãi vay', VND).", MONEY),
            "profit_before_tax": d("Tổng lợi nhuận kế toán trước thuế (VND, có thể âm).", SIGNED),
            "profit_after_tax": d("Lợi nhuận sau thuế thu nhập doanh nghiệp (VND, có thể âm).", SIGNED),
            "is_audited": d("Có báo cáo kiểm toán / dấu kiểm toán.", BOOL),
        }),
        "legal_info": LEGAL("issue_date = ngày lập báo cáo."),
    }, {"Party": party_def(["HOLDER"])})

    return s


EXPECTED = 20


def write_all() -> list[str]:
    schemas = build()
    if len(schemas) != EXPECTED:
        raise SystemExit(f"build_doc_schemas: kỳ vọng {EXPECTED} schema, có {len(schemas)}")
    OUT.mkdir(parents=True, exist_ok=True)
    for key, sch in schemas.items():
        (OUT / f"{key}.schema.json").write_text(json.dumps(sch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sorted(schemas)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    for k in write_all():
        print("wrote doc_schemas/" + k + ".schema.json")
