#!/usr/bin/env python3
"""Sinh hồ sơ vay hộ kinh doanh GIẢ LẬP theo schema đầu vào DU `dugate.loan-appraisal.integration` 5.0.

Mọi họ tên, số định danh, SĐT, địa chỉ ở đây là bịa; không lấy từ hồ sơ thật nào.
Mỗi kịch bản = hồ sơ gốc (sạch) + một nhóm thay đổi cài sẵn tình huống cần kiểm (spec 002 §8).

  python tests/fixtures/make_synthetic.py            # ghi tests/fixtures/hkd_*.json
  python tests/fixtures/make_synthetic.py --check    # kiểm file trên đĩa khớp với script
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ----------------------------------------------------------------------------- giá trị giả
# Tập giá trị định danh được phép xuất hiện trong fixture (test_fixtures kiểm điều này).
BORROWER = {"id": "party-1", "name": "TRẦN THỊ MAI", "nid": "001192012345", "prev": "012345678",
            "dob": "1992-03-14", "gender": "FEMALE", "phone": "0912000001",
            "card_issue": "2024-08-20", "card_until": "2032-03-14", "old_card_issue": "2021-03-01"}
SPOUSE = {"id": "party-2", "name": "LÊ VĂN HÙNG", "nid": "001090054321", "prev": "012987654",
          "dob": "1990-07-02", "gender": "MALE", "phone": "0912000002",
          "card_issue": "2023-05-10", "card_until": "2030-07-02", "old_card_issue": "2020-11-11"}
CERT = "AB123456"
BIZ_REG = "0100000001"
CIC_CODE = "9000000001"
FAKE_NUMBERS = {BORROWER["nid"], BORROWER["prev"], BORROWER["phone"], SPOUSE["nid"], SPOUSE["prev"],
                SPOUSE["phone"], CERT, BIZ_REG, CIC_CODE}

HOME = {"street": "Thôn Đông", "ward": "Xã Tân Lập", "district": "Huyện Đan Phượng",
        "province": "Thành phố Hà Nội",
        "full_text": "Thôn Đông, Xã Tân Lập, Huyện Đan Phượng, Thành phố Hà Nội"}
HOME_NEW = {"street": "Thôn Đông", "ward": "Xã Tân Lập", "province": "Thành phố Hà Nội",
            "full_text": "Thôn Đông, Xã Tân Lập, Thành phố Hà Nội"}
SPOUSE_WORK = {"street": "Số 8 Ngõ 12 Phố Hoa", "ward": "Phường Mai Dịch", "province": "Thành phố Hà Nội",
               "full_text": "Số 8 Ngõ 12 Phố Hoa, Phường Mai Dịch, Thành phố Hà Nội"}
CARD_AUTH = "BỘ CÔNG AN"
OLD_AUTH = "Cục Cảnh sát quản lý hành chính về trật tự xã hội"

REF_DATE = "2026-10-23"


# ----------------------------------------------------------------------------- helpers
def fields(d: dict, prefix: str = "") -> list[dict]:
    """dict lồng -> danh sách {path, value, status} như DU trả. `Conflict([...])` -> CONFLICT + candidates."""
    out = []
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        out += _emit(p, v)
    return out


class Conflict(list):
    pass


def _emit(p, v):
    if isinstance(v, Conflict):
        return [{"path": p, "value": None, "status": "CONFLICT", "candidates": list(v)}]
    if isinstance(v, dict) and "full_text" not in v:
        return fields(v, p)
    if isinstance(v, list):
        out = []
        for i, x in enumerate(v):
            out += _emit(f"{p}[{i}]", x)
        return out
    return [{"path": p, "value": v, "status": "AGREED"}]


def person(p: dict, role: str, **extra) -> dict:
    d = {"party_role": role, "date_of_birth": p["dob"], "gender": p["gender"]}
    d.update(extra)
    return d


# ----------------------------------------------------------------------------- hồ sơ gốc
def base_docs() -> dict:
    """Chứng từ dạng dict lồng, khoá = tên logic. Thứ tự giữ ổn định."""
    b, s = BORROWER, SPOUSE
    return {
        "id_card_b": ("id_card", "legal_id_card", {
            "legal_info": {"document_title": "CĂN CƯỚC", "document_number": b["nid"],
                           "issuing_authority": CARD_AUTH, "issue_date": b["card_issue"],
                           "valid_until": b["card_until"]},
            "card_info": {"place_of_birth_registration": "Xã Tân Lập, Thành phố Hà Nội"},
            "parties": [person(b, "HOLDER", nationality="Việt Nam", id_issue_date=b["card_issue"],
                               permanent_address=HOME_NEW)]}),
        "qr_b": ("qr_code_info", "legal_qr_code_info", {
            "parties": [person(b, "HOLDER", id_type="CAN_CUOC", id_issue_date=b["card_issue"],
                               previous_id_numbers=[b["prev"]], permanent_address=HOME_NEW)]}),
        "vneid_b": ("vneid", "legal_vneid", {
            "legal_info": {"document_title": "Thông tin cá nhân"},
            "parties": [person(b, "HOLDER", nationality="Việt Nam", id_type="CAN_CUOC",
                               permanent_address=HOME_NEW, phone_number=b["phone"])]}),
        "id_card_s": ("id_card", "legal_id_card", {
            "legal_info": {"document_title": "CĂN CƯỚC CÔNG DÂN", "document_number": s["nid"],
                           "issuing_authority": OLD_AUTH, "issue_date": s["card_issue"],
                           "valid_until": s["card_until"]},
            "parties": [person(s, "HOLDER", nationality="Việt Nam", id_issue_date=s["card_issue"],
                               permanent_address=HOME_NEW)]}),
        "marriage": ("marriage_certificate", "legal_marriage_certificate", {
            "legal_info": {"document_title": "GIẤY CHỨNG NHẬN KẾT HÔN", "issue_date": "2023-04-15"},
            "registration_date": "2023-04-15", "place_of_registration": "UBND Xã Tân Lập",
            "parties": [
                person(b, "WIFE", nationality="Việt Nam", id_type="CCCD", id_issue_date=b["old_card_issue"],
                       id_issue_place=OLD_AUTH, permanent_address=HOME),
                person(s, "HUSBAND", nationality="Việt Nam", id_type="CCCD", id_issue_date=s["old_card_issue"],
                       id_issue_place=OLD_AUTH, permanent_address=HOME)]}),
        "loan_app": ("loan_application", "loan_plan_loan_application", {
            "legal_info": {"document_title": "GIẤY ĐỀ NGHỊ VAY VỐN CÓ TÀI SẢN BẢO ĐẢM", "issue_date": "2026-10-01",
                           "signatories": [{"full_name": b["name"], "sign_date": "2026-10-01"}]},
            "parties": [
                person(b, "BORROWER", nationality="Việt Nam", id_type="CAN_CUOC", id_issue_date=b["card_issue"],
                       id_issue_place=CARD_AUTH, permanent_address=HOME, current_address=HOME,
                       previous_id_numbers=[b["prev"]], phone_number=b["phone"]),
                person(s, "SPOUSE", id_type="CCCD", id_issue_date=s["card_issue"], id_issue_place=OLD_AUTH,
                       current_address=SPOUSE_WORK, phone_number=s["phone"])],
            "party_details": [{"marital_status": "MARRIED"},
                              {"relationship_to_borrower": "SPOUSE", "marital_status": "MARRIED"}],
            "loan_info": {"borrower_type": "Hộ kinh doanh", "requested_amount": 800000000,
                          "bank_proposed_amount": 800000000, "loan_term_months": 36,
                          "interest_rate_code": "HKD-STD", "interest_rate_raw": "Theo biểu lãi suất HKD-STD",
                          "loan_purposes": ["Bổ sung vốn lưu động kinh doanh"],
                          "loan_purpose_detail": "Nhập hàng tạp hoá", "loan_purpose_categories": ["WORKING_CAPITAL"],
                          "disbursement_method": "Chuyển khoản", "principal_repayment_method": "Trả gốc cuối kỳ",
                          "interest_repayment_method": "Trả lãi hàng tháng"},
            "financial_info": {"total_income": 300000000, "total_income_period": "ANNUAL",
                               "repayment_source": "Lợi nhuận từ kinh doanh", "has_existing_debt": False,
                               "existing_monthly_debt_payment": 0},
            "officer_info": {"branch": "Chi nhánh Mẫu", "decision_date": "2026-10-01"},
            "business_info": {"business_name": "Hộ Kinh Doanh Trần Thị Mai", "business_line": "Bán lẻ tạp hoá",
                              "business_address": HOME_NEW, "registration_number": BIZ_REG},
            "assets": [{"identifiers": {"certificate_number": CERT}, "usage_context_hint": "COLLATERAL"}],
            "asset_details": [{"owner_party_indexes": [0], "owner_names_raw": f"Bà {b['name']}",
                               "collateral_type_raw": "Quyền sử dụng đất"}],
            "collateral_summary": {"notes": [f"GCN QSDĐ số {CERT}"]}}),
        "purchase": ("purchase_list", "loan_plan_purchase_list", {
            "legal_info": {"document_title": "BẢNG KÊ DANH MỤC HÀNG HOÁ CẦN NHẬP", "issue_date": "2026-10-01",
                           "signatories": [{"full_name": b["name"], "sign_date": "2026-10-01"}]},
            "parties": [person(b, "CUSTOMER", id_issue_date=b["card_issue"], id_issue_place=CARD_AUTH,
                               phone_number=b["phone"])],
            "funding_plan": {"total_amount": 800000000},
            "items": [
                {"item_no": 1, "item_name": "Gạo đóng túi 5kg", "unit": "túi", "quantity": 2000,
                 "unit_price": 100000, "amount": 200000000},
                {"item_no": 2, "item_name": "Dầu ăn 2l", "unit": "chai", "quantity": 4000,
                 "unit_price": 75000, "amount": 300000000},
                {"item_no": 3, "item_name": "Nước giải khát thùng 24", "unit": "thùng", "quantity": 1500,
                 "unit_price": 200000, "amount": 300000000}]}),
        "income": ("income_statement", "income_general_income_statement", {
            "legal_info": {"document_title": "BẢNG KÊ THU NHẬP", "issue_date": "2026-10-01",
                           "signatories": [{"full_name": b["name"], "sign_date": "2026-10-01"}]},
            "parties": [person(b, "CUSTOMER", id_type="CAN_CUOC", id_issue_date=b["card_issue"],
                               id_issue_place=CARD_AUTH, permanent_address=HOME)],
            "income_sources": [{"income_type": "household_business",
                                "source_label_raw": "Thu nhập từ hoạt động kinh doanh của hộ kinh doanh",
                                "household_business": {
                                    "business_name": "Hộ Kinh Doanh Trần Thị Mai",
                                    "business_line": "Bán lẻ tạp hoá", "business_address": HOME_NEW,
                                    "operating_time_raw": "36 tháng", "premises_type_raw": "Thuê",
                                    "premises_area_m2": 40, "net_revenue_annual": 1500000000,
                                    "cogs_annual": 1050000000, "gross_profit_annual": 450000000,
                                    "total_cost_annual": 150000000, "net_profit_annual": 300000000}}]}),
        "land_cert": ("land_use_certificate", "collateral_real_estate_certificate", {
            "legal_info": {"document_title": "GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT", "issue_date": "2021-06-01"},
            "parties": [{"party_role": "OWNER"}],
            "assets": [{"asset_type": "real_estate",
                        "identifiers": {"certificate_number": "AB 123456", "certificate_book_number": "CS 0001",
                                        "land_parcel_number": "101", "map_sheet_number": "7"},
                        "address": HOME_NEW, "description": "Thửa đất số: 101; tờ bản đồ số: 7",
                        "land_area_m2": 120.5, "land_use_purpose": "Đất ở tại nông thôn 120,5m2",
                        "land_use_term_raw": "Đất ở tại nông thôn: Lâu dài"}],
            "asset_details": [{"ownership_form": "Sử dụng chung", "owner_party_indexes": [0]}]}),
        "valuation": ("valuation_certificate", "collateral_valuation_certificate", {
            "legal_info": {"document_title": "CHỨNG THƯ THẨM ĐỊNH GIÁ", "issue_date": "2026-09-25",
                           "issuing_authority": "Công ty Thẩm định giá Mẫu"},
            "assets": [{"identifiers": {"certificate_number": CERT}, "asset_value": 1600000000}]}),
        "cic": ("cic", "credit_cic_report", {
            "legal_info": {"document_title": "BÁO CÁO CHI TIẾT QUAN HỆ TÍN DỤNG",
                           "issuing_authority": "Trung tâm Thông tin tín dụng Quốc gia"},
            "parties": [{"party_role": "HOLDER", "previous_id_numbers": [b["prev"]], "current_address": HOME}],
            "reports": [{"report_datetime": "2026-10-10T09:00:00+07:00", "cic_code": CIC_CODE,
                         "current_debt_group_raw": "Hiện tại khách hàng không có dư nợ vay tại các TCTD.",
                         "bad_debt_5y": {"has_records": False, "records_raw": "Không có nợ xấu 5 năm."},
                         "queried_institutions_1y_count": 1,
                         "queried_institutions": [{"institution": "Ngân hàng Mẫu", "query_date": "2026-10-10"}]}]}),
    }


CHECKLIST = [
    ("legal_id_card", True), ("legal_qr_code_info", False), ("legal_vneid", False),
    ("legal_marriage_certificate", True), ("loan_plan_loan_application", True),
    ("loan_plan_purchase_list", True), ("income_general_income_statement", True),
    ("collateral_real_estate_certificate", True), ("collateral_valuation_certificate", True),
    ("credit_cic_report", True),
]


def assemble(case_id: str, docs: dict, asset_value_in_case: int | None = None) -> dict:
    b, s = BORROWER, SPOUSE
    party_hint = {"id_card_b": b["id"], "qr_b": b["id"], "vneid_b": b["id"], "id_card_s": s["id"]}
    records = [{"doc": t, "item": item, "party": party_hint.get(k, b["id"]), "fields": fields(d)}
               for k, (t, item, d) in docs.items()]
    asset_fields = [{"path": "asset_type", "value": "real_estate", "status": "AGREED"}]
    if asset_value_in_case is not None:
        asset_fields.append({"path": "asset_value", "value": asset_value_in_case, "status": "AGREED"})
    return {
        "case": {"id": case_id, "completed_at": REF_DATE,
                 "profile": {"segment": "HKD", "product": "PP-HKD-SECURED",
                             "product_name": "Vay hộ kinh doanh có TSBĐ (giả lập)", "flow": "FAST"}},
        "parties": [
            {"id": p["id"], "type": "INDIVIDUAL", "name": p["name"],
             "identifiers": [{"type": "NATIONAL_ID", "value": p["nid"]}],
             "fields": [{"path": "date_of_birth", "value": p["dob"], "status": "AGREED"},
                        {"path": "gender", "value": p["gender"], "status": "AGREED"}]}
            for p in (b, s)],
        "assets": [{"id": "asset-1", "type": "real_estate",
                    "identifiers": [{"type": "CERTIFICATE_NUMBER", "value": CERT}], "fields": asset_fields}],
        "documents": {"items": [{"key": k, "required": r} for k, r in CHECKLIST], "records": records},
    }


# ----------------------------------------------------------------------------- kịch bản
def sc_baseline(docs):
    """Hồ sơ đủ, nhất quán: chỉ còn các biến thể N (địa chỉ có/không cấp huyện, giấy tờ cũ trên giấy kết hôn)."""
    return docs, {}


def sc_cic_spouse_stale(docs):
    """CIC tra cứu nhầm sang chồng, lập đã lâu, có lượt tra cứu sau ngày lập (AC-1)."""
    cic = docs["cic"][2]
    cic["parties"][0] = {"party_role": "HOLDER", "previous_id_numbers": [SPOUSE["prev"]],
                         "current_address": SPOUSE_WORK}
    rep = cic["reports"][0]
    rep["report_datetime"] = "2026-07-01T09:00:00+07:00"
    rep["queried_institutions"] = [{"institution": "Ngân hàng Mẫu", "query_date": "2026-06-20"},
                                   {"institution": "Ngân hàng Mẫu", "query_date": "2026-12-03"}]
    return docs, {}


def sc_income_x12(docs):
    """Thu nhập đơn vay theo THÁNG bằng đúng lợi nhuận NĂM trên bảng kê (AC-3)."""
    docs["loan_app"][2]["financial_info"]["total_income_period"] = "MONTHLY"
    return docs, {}


def sc_address_variants(docs):
    """Bốn cách viết một địa chỉ thường trú; không lỗi (AC-2)."""
    v1 = dict(HOME)
    v2 = dict(HOME_NEW)
    v3 = {"street": "Thôn Đông", "ward": "Tân Lập", "province": "Hà Nội", "full_text": "Thôn Đông, Tân Lập, Hà Nội"}
    v4 = {"street": "THÔN ĐÔNG", "ward": "XÃ TÂN LẬP", "district": "HUYỆN ĐAN PHƯỢNG", "province": "TP HÀ NỘI",
          "full_text": "THÔN ĐÔNG, XÃ TÂN LẬP, HUYỆN ĐAN PHƯỢNG, TP HÀ NỘI"}
    docs["id_card_b"][2]["parties"][0]["permanent_address"] = v2
    docs["vneid_b"][2]["parties"][0]["permanent_address"] = v3
    docs["loan_app"][2]["parties"][0]["permanent_address"] = v1
    docs["income"][2]["parties"][0]["permanent_address"] = v4
    return docs, {}


def sc_self_declared_mismatch(docs):
    """Tự khai ghi sai loại/nơi cấp giấy tờ; thẻ đọc ra nhiều ứng viên; thời hạn đất bị cắt (AC-5)."""
    la = docs["loan_app"][2]["parties"][0]
    la["id_type"] = "CCCD"
    docs["purchase"][2]["parties"][0]["id_issue_place"] = "Cục Cảnh sát QLHC về TTXH"
    docs["income"][2]["parties"][0]["id_type"] = "CCCD"
    docs["qr_b"][2]["parties"][0]["id_type"] = "CCCD"
    docs["id_card_b"][2]["parties"][0]["id_issue_place"] = Conflict([CARD_AUTH, OLD_AUTH.upper()])
    docs["land_cert"][2]["assets"][0]["land_use_term_raw"] = Conflict(
        ["Đất ở tại nông thôn: Lâu dài", "Lâu dài"])
    return docs, {}


def sc_forms_plan_role(docs):
    """Bảng kê thu nhập thiếu chữ ký và ngày; chồng là đồng vay trên bảng kê; phương án vốn lệch số vay
    và sai số học; không có chứng thư định giá, giá trị TSBĐ chỉ có ở dữ liệu tổng hợp; chồng không có thẻ."""
    inc = docs["income"][2]
    inc["legal_info"] = {"document_title": "BẢNG KÊ THU NHẬP"}
    inc["parties"].append(person(SPOUSE, "CO_BORROWER"))
    pl = docs["purchase"][2]
    pl["funding_plan"]["total_amount"] = 850000000
    pl["items"][1]["amount"] = 350000000
    del docs["valuation"]
    del docs["id_card_s"]
    return docs, {"asset_value_in_case": 1150000000}


SCENARIOS = {
    "hkd_baseline": sc_baseline,
    "hkd_cic_spouse_stale": sc_cic_spouse_stale,
    "hkd_income_x12": sc_income_x12,
    "hkd_address_variants": sc_address_variants,
    "hkd_self_declared_mismatch": sc_self_declared_mismatch,
    "hkd_forms_plan_role": sc_forms_plan_role,
}


def build_all() -> dict[str, str]:
    out = {}
    for i, (name, fn) in enumerate(SCENARIOS.items(), 1):
        docs, kw = fn(copy.deepcopy(base_docs()))
        case = assemble(f"SYN-HKD-{i:04d}", docs, **kw)
        out[name] = json.dumps(case, ensure_ascii=False, indent=1) + "\n"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    bad = []
    for name, text in build_all().items():
        p = HERE / f"{name}.json"
        if a.check:
            if not p.exists() or p.read_text(encoding="utf-8") != text:
                bad.append(p.name)
        else:
            p.write_text(text, encoding="utf-8")
    if bad:
        print("fixture lệch với script: " + ", ".join(bad), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
