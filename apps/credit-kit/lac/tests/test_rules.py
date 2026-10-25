"""Mỗi quy tắc R-* có ít nhất một ca dương (hồ sơ gốc + một thay đổi) và ca âm (hồ sơ gốc sạch).

Ca được dựng bằng make_synthetic.base_docs()/assemble() để chỉ khác hồ sơ gốc đúng chỗ cần kiểm.
"""
import copy
import sys
from datetime import date

import pytest

from conftest import FIXTURES, REF_DATE
from lac.validate import Validator

sys.path.insert(0, str(FIXTURES))
import make_synthetic as ms  # noqa: E402


def run(mut_docs=None, mut_case=None, ref=REF_DATE, **assemble_kw):
    docs = copy.deepcopy(ms.base_docs())
    if mut_docs:
        mut_docs(docs)
    case = ms.assemble("SYN-TEST", docs, **assemble_kw)
    if mut_case:
        mut_case(case)
    return Validator(case, ref).run()


def hits(v, rule, cls=None):
    return [x for x in v.disc if x["rule"] == rule and (cls is None or x["class"] == cls)]


def non_n(v):
    return [x for x in v.disc if x["class"] != "N"]


def d(docs, key):
    return docs[key][2]


@pytest.fixture(scope="module")
def base():
    return run()


# ---------------------------------------------------------------- ca âm chung
def test_baseline_has_only_n_variants(base):
    assert non_n(base) == [], [x["title"] for x in non_n(base)]
    assert all(x["severity"] == "S4" for x in base.disc)


ALL_RULES = ["R-CROSS", "R-ONEOF", "R-INCOME", "R-ROLE", "R-CROSS-DOC", "R-CIC-SUBJECT", "R-CIC-AGE",
             "R-DATE", "R-ID-FORMAT", "R-ID-EXPIRY", "R-FORMAT", "R-ARITH", "R-FORM", "R-NAME", "R-SOURCE",
             "R-REQUIRED"]


@pytest.mark.parametrize("rule", ALL_RULES)
def test_baseline_negative(base, rule):
    assert [x for x in non_n(base) if x["rule"] == rule] == []


# ---------------------------------------------------------------- R-CROSS / R-NORM / R-ONEOF
def test_cross_c1_meaningful_difference():
    v = run(lambda docs: d(docs, "loan_app")["parties"][0].update(nationality="Lào"))
    x = hits(v, "R-CROSS", "C")
    assert x and x[0]["subclass"] == "C1" and x[0]["to_branch2"]


def test_cross_a1_two_char_id_typo():
    v = run(lambda docs: d(docs, "loan_app")["parties"][0].update(previous_id_numbers=["012345679"]))
    x = [y for y in hits(v, "R-CROSS", "A|B") if y["subclass"] == "A1"]
    assert x, [y["title"] for y in v.disc]


def test_cross_b4_self_declared_id_doc():
    v = run(lambda docs: d(docs, "purchase")["parties"][0].update(id_issue_place="Công an tỉnh"))
    assert [y for y in hits(v, "R-CROSS", "A|B") if y["subclass"] == "B4"]


def test_cross_a4_tier1_differs_from_tier0():
    v = run(lambda docs: d(docs, "qr_b")["parties"][0].update(id_type="CCCD"))
    assert [y for y in hits(v, "R-CROSS", "A") if y["subclass"] == "A4"]


def test_norm_variants_are_n():
    v = run(lambda docs: d(docs, "land_cert")["assets"][0]["identifiers"].update(certificate_number="AB-123456"))
    assert hits(v, "R-NORM", "N") and not non_n(v)


def test_oneof_contained_candidates_a5():
    v = run(lambda docs: d(docs, "land_cert")["assets"][0].update(
        land_use_term_raw=ms.Conflict(["Đất ở tại nông thôn: Lâu dài", "Lâu dài"])))
    x = hits(v, "R-ONEOF")
    assert x and x[0]["subclass"] == "A5"
    f = v.facts[("A1", "land_use_term_raw")]
    assert f["canonical"] == "Đất ở tại nông thôn: Lâu dài"


def test_oneof_unmatched_candidates_unresolved():
    v = run(lambda docs: d(docs, "land_cert")["assets"][0].update(land_use_purpose=ms.Conflict(["A", "B"])))
    assert v.facts[("A1", "land_use_purpose")]["status"] == "chưa xác định"


# ---------------------------------------------------------------- liên chứng từ
def test_income_x12_is_c1():
    v = run(lambda docs: d(docs, "loan_app")["financial_info"].update(total_income_period="MONTHLY"))
    x = hits(v, "R-INCOME")
    assert len(x) == 1 and x[0]["class"] == "C" and x[0]["severity"] == "S2" and "hệ số 12" in x[0]["note"]


def test_income_within_tolerance_ok():
    v = run(lambda docs: d(docs, "loan_app")["financial_info"].update(total_income=320000000))
    assert not hits(v, "R-INCOME")


def test_role_mismatch_c2():
    v = run(lambda docs: d(docs, "income")["parties"].append(ms.person(ms.SPOUSE, "CO_BORROWER")))
    x = hits(v, "R-ROLE")
    assert x and x[0]["subclass"] == "C2" and x[0]["canonical"].startswith("SPOUSE")


def test_cross_doc_plan_total_vs_loan():
    def m(docs):
        d(docs, "purchase")["funding_plan"]["total_amount"] = 900000000
        d(docs, "purchase")["items"][0]["amount"] = 300000000
        d(docs, "purchase")["items"][0]["quantity"] = 3000
    assert hits(run(m), "R-CROSS-DOC", "C")


# ---------------------------------------------------------------- CIC
def test_cic_subject_is_spouse():
    def m(docs):
        d(docs, "cic")["parties"][0] = {"party_role": "HOLDER", "previous_id_numbers": [ms.SPOUSE["prev"]],
                                        "current_address": ms.SPOUSE_WORK}
    x = hits(run(m), "R-CIC-SUBJECT")
    assert x and x[0]["severity"] == "S1" and "P2" in x[0]["title"]


def test_cic_age():
    v = run(lambda docs: d(docs, "cic")["reports"][0].update(report_datetime="2026-08-01T09:00:00+07:00"))
    x = hits(v, "R-CIC-AGE")
    assert x and x[0]["severity"] == "S1"
    assert not hits(Validator(copy.deepcopy(v.d), REF_DATE, cic_max_age=120).run(), "R-CIC-AGE")


def test_cic_query_after_report():
    v = run(lambda docs: d(docs, "cic")["reports"][0]["queried_institutions"].append(
        {"institution": "Ngân hàng Mẫu", "query_date": "2026-10-20"}))
    assert [x for x in hits(v, "R-DATE") if "tra cứu CIC" in x["title"]]


# ---------------------------------------------------------------- định dạng, cấu trúc
def test_date_invalid_and_future():
    def m(docs):
        d(docs, "loan_app")["officer_info"]["decision_date"] = "2026-02-30"
        d(docs, "loan_app")["legal_info"]["issue_date"] = "2027-01-05"
    v = run(m)
    titles = " ".join(x["title"] for x in hits(v, "R-DATE"))
    assert "không phải ngày hợp lệ" in titles and "sau ngày tham chiếu" in titles


def _set_nid(case, nid):
    case["parties"][0]["identifiers"][0]["value"] = nid
    for r in case["documents"]["records"]:
        for f in r["fields"]:
            if f["path"] == "legal_info.document_number" and f["value"] == ms.BORROWER["nid"]:
                f["value"] = nid


def test_id_format_province_and_gender():
    v = run(mut_case=lambda c: _set_nid(c, "999092012345"))
    t = " ".join(x["detail"] for x in hits(v, "R-ID-FORMAT"))
    assert "mã tỉnh 999" in t and "giới tính" in t


def test_id_expiry_expired():
    v = run(lambda docs: d(docs, "id_card_b")["legal_info"].update(valid_until="2026-01-01"))
    assert [x for x in hits(v, "R-ID-EXPIRY", "B")]


def test_id_expiry_wrong_age_mark():
    v = run(lambda docs: d(docs, "id_card_b")["legal_info"].update(valid_until="2034-03-14"))
    assert [x for x in hits(v, "R-ID-EXPIRY", "A|B") if x["subclass"] == "A2"]


def test_phone_format():
    v = run(lambda docs: d(docs, "vneid_b")["parties"][0].update(phone_number="091200000"))
    assert hits(v, "R-FORMAT")


def test_business_registration_format():
    v = run(lambda docs: d(docs, "loan_app")["business_info"].update(registration_number="12345"))
    assert [x for x in hits(v, "R-FORMAT") if "registration_number" in x["title"]]


def test_arith_line_and_business():
    def m(docs):
        d(docs, "purchase")["items"][1]["amount"] = 310000000
        d(docs, "purchase")["funding_plan"]["total_amount"] = 810000000
        d(docs, "income")["income_sources"][0]["household_business"]["gross_profit_annual"] = 460000000
    titles = [x["title"] for x in hits(run(m), "R-ARITH")]
    assert any("dòng 2" in t for t in titles) and any("lãi gộp" in t for t in titles)


# ---------------------------------------------------------------- hình thức, tên, nguồn
def test_form_missing_signature_and_date():
    v = run(lambda docs: d(docs, "income").update(legal_info={"document_title": "BẢNG KÊ THU NHẬP"}))
    x = hits(v, "R-FORM")
    assert x and x[0]["severity"] == "S1" and x[0]["class"] == "A|B"


def test_name_accent_difference_b1():
    v = run(lambda docs: d(docs, "loan_app")["legal_info"]["signatories"][0].update(full_name="TRẦN THI MAI"))
    assert [x for x in hits(v, "R-NAME") if x["subclass"] == "B1"]


def test_name_unaccented_is_ok():
    v = run(lambda docs: d(docs, "loan_app")["legal_info"]["signatories"][0].update(full_name="TRAN THI MAI"))
    assert not hits(v, "R-NAME")


def test_name_other_person_c1():
    v = run(lambda docs: d(docs, "purchase")["legal_info"]["signatories"][0].update(full_name="NGUYỄN VĂN AN"))
    assert [x for x in hits(v, "R-NAME") if x["class"] == "C"]


def test_source_asset_value_without_document():
    v = run(lambda docs: docs.pop("valuation"), asset_value_in_case=1600000000)
    assert [x for x in hits(v, "R-SOURCE") if "asset_value" in x["title"]]
    assert hits(v, "R-REQUIRED")


def test_source_participant_without_identity_doc():
    v = run(lambda docs: docs.pop("id_card_s"))
    assert [x for x in hits(v, "R-SOURCE") if "identity_documents" in x["fields"][0]]


def test_required_missing_cic():
    v = run(lambda docs: docs.pop("cic"))
    x = hits(v, "R-REQUIRED")
    assert x and x[0]["severity"] == "S1" and "credit_cic_report" in x[0]["title"]


# ---------------------------------------------------------------- nguyên tắc
def test_amounts_never_auto_corrected():
    """lac-rules §1.4: số tiền lệch không bị tự sửa — giá trị đọc được vẫn giữ trong observations."""
    v = run(lambda docs: d(docs, "loan_app")["financial_info"].update(total_income_period="MONTHLY"))
    f = v.facts[("L1", "financial_info.total_income")]
    assert [o["v"] for o in f["obs"]] == [300000000]


def test_business_line_income_statement_outranks_loan_application():
    def m(docs):
        d(docs, "loan_app")["business_info"]["business_line"] = "Bán buôn vật liệu"
    v = run(m)
    f = v.facts[("B1", "business_line")]
    # bảng kê (bậc 3) đứng trên đơn vay (bậc 3.5) -> chọn bảng kê, đơn vay ghi khác -> C
    assert f["canonical"] == "Bán lẻ tạp hoá"
    assert [x for x in hits(v, "R-CROSS", "C")]


def test_reference_date_controls_staleness():
    v_late = run(ref=date(2027, 12, 1))
    assert hits(v_late, "R-CIC-AGE")
