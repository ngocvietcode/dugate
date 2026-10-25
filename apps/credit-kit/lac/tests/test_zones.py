"""Vùng Tài chính và Phương án vốn (L10)."""
from conftest import FIXTURES, REF_DATE
from lac.export import build_lac
from lac.graph import load


def z(name):
    return build_lac(load(FIXTURES / f"{name}.json"), REF_DATE)["zones"]


def test_financials_have_period_annualized_and_source_type():
    fin = {r["metric"]: r for r in z("hkd_income_x12")["financials"]}
    d = fin["declared_income"]
    assert (d["period"], d["value"], d["annualized"], d["source_type"]) == ("MONTHLY", 300000000, 3600000000, "SELF_DECLARED")
    assert any(fl.endswith(":C") for fl in d["flags"])
    r = fin["revenue"]
    assert (r["period"], r["annualized"], r["source_type"]) == ("ANNUAL", 1500000000, "SELF_DECLARED")
    assert fin["existing_debt_payment"]["period"] == "MONTHLY"


def test_funding_plan_total_and_items_sum():
    plans = z("hkd_forms_plan_role")["funding_plans"]
    assert len(plans) == 1
    p = plans[0]
    assert p["loan"] == "L1" and p["total"] == 850000000 and p["items_sum"] == 850000000
    assert len(p["items"]) == 3 and p["source_type"] == "SELF_DECLARED"


def test_baseline_plan_matches_loan():
    p = z("hkd_baseline")["funding_plans"][0]
    assert p["total"] == p["items_sum"] == 800000000
