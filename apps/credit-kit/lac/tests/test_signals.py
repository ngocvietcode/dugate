"""Chỉ số tính sẵn và tín hiệu chéo vùng (spec 002 FR-11, FR-12, AC-6)."""
import copy
import sys

import pytest

from conftest import FIXTURES, REF_DATE
from lac.export import build_lac

sys.path.insert(0, str(FIXTURES))
import make_synthetic as ms  # noqa: E402


def lac(mut=None, interest_rate=None, **kw):
    docs = copy.deepcopy(ms.base_docs())
    if mut:
        mut(docs)
    return build_lac(ms.assemble("SYN-SIG", docs, **kw), REF_DATE, interest_rate=interest_rate)


def M(l):
    return {m["id"]: m for m in l["metrics"]}


def T(l):
    return {t["rule"]: t for t in l["signals"]}


# Bảng đối chứng tính tay cho hồ sơ gốc: vay 800tr, TSBĐ 1,6 tỷ, DT 1,5 tỷ, GV 1,05 tỷ, LN 300tr, 36 tháng
EXPECTED = {"M-LTV": 0.5, "M-LOAN-REVENUE": 0.5333, "M-PLAN-COGS": 0.7619, "M-MARGIN": 0.2, "M-BULLET": 0.8889}


@pytest.mark.parametrize("mid,val", EXPECTED.items())
def test_ac6_metrics_match_hand_calculation(mid, val):
    assert M(lac())[mid]["value"] == val


def test_ac6_dscr_not_computable_without_numeric_rate():
    m = M(lac())["M-DSCR"]
    assert m["status"] == "not_computable" and m["missing"] == ["lãi suất năm (số)"]
    t = [x for x in lac()["signals"] if x["rule"] == "R-X-METRIC-INPUT"]
    assert t and "thiếu: lãi suất năm (số)" in t[0]["detail"]


def test_dscr_with_rate_bullet_interest_only():
    # 300tr / (800tr × 10%) = 3.75
    assert M(lac(interest_rate=0.10))["M-DSCR"]["value"] == 3.75


def test_dscr_amortizing_includes_principal():
    m = lac(lambda d: d["loan_app"][2]["loan_info"].update(principal_repayment_method="Trả gốc đều hàng tháng"),
            interest_rate=0.10)
    # 300 / (80 + 800/3) = 300 / 346.6667 = 0.8654
    assert M(m)["M-DSCR"]["value"] == 0.8654
    assert "M-BULLET" not in M(m)


def test_plan_cogs_signal_includes_premises():
    t = T(lac())["R-X-PLAN-COGS"]
    assert "Thuê 40 m²" in t["detail"] and t["threshold"] == 0.5


def test_ltv_margin_signal_near_cap():
    l = lac(lambda d: d["valuation"][2]["assets"][0].update(asset_value=1145000000))  # 800/1145 = 0.6987
    t = T(l)["R-X-LTV-MARGIN"]
    assert M(l)["M-LTV"]["value"] == 0.6987
    assert "thấp hơn 2.142.857 đồng là vượt trần" in t["detail"]


def test_ltv_signal_when_value_has_no_source():
    l = lac(lambda d: d.pop("valuation"), asset_value_in_case=1600000000)
    t = T(l)["R-X-LTV-MARGIN"]
    assert "không có chứng từ nguồn" in t["detail"] and t["discrepancies"]


def test_no_ltv_signal_when_comfortable():
    assert "R-X-LTV-MARGIN" not in T(lac())


def test_marital_asset_signal():
    def m(d):
        d["land_cert"][2]["legal_info"]["issue_date"] = "2025-01-10"
        d["land_cert"][2]["asset_details"][0]["ownership_form"] = "Sử dụng riêng"
    t = T(lac(m))["R-X-MARITAL-ASSET"]
    assert "2025-01-10" in t["detail"] and "2023-04-15" in t["detail"]


def test_no_marital_signal_before_marriage():
    assert "R-X-MARITAL-ASSET" not in T(lac(lambda d: d["land_cert"][2]["asset_details"][0].update(
        ownership_form="Sử dụng riêng")))


def test_bullet_and_loan_revenue_signals():
    def m(d):
        hb = d["income"][2]["income_sources"][0]["household_business"]
        hb.update(net_revenue_annual=600000000, cogs_annual=420000000, gross_profit_annual=180000000,
                  total_cost_annual=30000000, net_profit_annual=150000000)
        d["loan_app"][2]["financial_info"]["total_income"] = 150000000
    l = lac(m)
    assert M(l)["M-BULLET"]["value"] == 1.7778 and "R-X-BULLET" in T(l)
    assert M(l)["M-LOAN-REVENUE"]["value"] == 1.3333 and "R-X-LOAN-REVENUE" in T(l)


def test_income_conflict_flags_metrics():
    l = lac(lambda d: d["loan_app"][2]["financial_info"].update(total_income_period="MONTHLY"))
    t = T(l)["R-X-INCOME-USE"]
    assert t["discrepancies"] and "M-BULLET" in t["metrics"]


def test_branch2_extract_contains_metrics_and_signals():
    md = lac()["branch2"]["markdown"]
    assert "## Chỉ số tính sẵn" in md and "M-LTV LTV = 0.5" in md and "## Tín hiệu chéo vùng (T#)" in md
