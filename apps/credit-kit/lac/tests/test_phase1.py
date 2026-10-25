"""Cổng Giai đoạn 1 (spec 002 FR-5, FR-6, AC-1)."""
import copy
import sys

from conftest import FIXTURES, REF_DATE
from lac.phase1 import phase1_gate
from lac.validate import Validator

sys.path.insert(0, str(FIXTURES))
import make_synthetic as ms  # noqa: E402


def gate(name=None, mut=None):
    if name:
        from lac.graph import load
        data = load(FIXTURES / f"{name}.json")
    else:
        docs = copy.deepcopy(ms.base_docs())
        mut(docs)
        data = ms.assemble("SYN-P1", docs)
    return phase1_gate(Validator(data, REF_DATE).run())


def item(g, key):
    return next(r for r in g["items"] if r["key"] == key)


def test_baseline_complete():
    g = gate("hkd_baseline")
    assert g["status"] == "COMPLETE", [(r["key"], r["status"], r["reasons"]) for r in g["items"] if r["status"] != "PASS"]
    assert all(r["status"] == "PASS" for r in g["items"])


def test_ac1_cic_of_spouse_is_missing_for_borrower():
    g = gate("hkd_cic_spouse_stale")
    r = item(g, "credit_cic_report")
    assert r["status"] == "MISSING" and r["subject"] == "P1"
    assert any("cần của người vay P1" in x for x in r["reasons"])
    assert g["status"] == "INCOMPLETE"


def test_stale_cic_of_borrower_is_missing():
    g = gate(mut=lambda d: d["cic"][2]["reports"][0].update(report_datetime="2026-08-01T09:00:00+07:00"))
    r = item(g, "credit_cic_report")
    assert r["status"] == "MISSING" and any("hiệu lực 30 ngày" in x for x in r["reasons"])


def test_substitute_document_accepted():
    """Bảng kê hàng hoá thay hợp đồng mua bán (chứng từ thay thế)."""
    assert item(gate("hkd_baseline"), "loan_plan_purchase_list")["status"] == "PASS"


def test_missing_valuation_and_spouse_card():
    g = gate("hkd_forms_plan_role")
    assert item(g, "collateral_valuation_certificate")["status"] == "MISSING"
    assert item(g, "legal_spouse_id_card")["status"] == "MISSING"


def test_expired_id_card():
    g = gate(mut=lambda d: d["id_card_b"][2]["legal_info"].update(valid_until="2026-01-01"))
    # VNeID vẫn thay được thẻ hết hạn
    r = item(g, "legal_id_card")
    assert r["status"] == "PASS" and r["docs"] and any("hết hạn" in x for x in r["reasons"])


def test_expired_id_card_without_vneid_is_missing():
    def m(d):
        d["id_card_b"][2]["legal_info"]["valid_until"] = "2026-01-01"
        del d["vneid_b"]
    assert item(gate(mut=m), "legal_id_card")["status"] == "MISSING"


def test_valuation_for_other_asset_not_counted():
    def m(d):
        d["valuation"][2]["assets"][0]["identifiers"]["certificate_number"] = "ZZ999999"
    r = item(gate(mut=m), "collateral_valuation_certificate")
    assert r["status"] == "MISSING"
