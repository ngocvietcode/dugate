"""Spec 002 acceptance criteria phần LAC (AC-2..AC-5, AC-7) trên fixture giả lập."""
from conftest import run_case


def test_ac2_address_variants_one_fact_n_only(validator):
    v = validator("hkd_address_variants")
    f = v.facts[("P1", "permanent_address")]
    assert f["status"] == "ok" and len({o["doc"] for o in f["obs"]}) >= 4
    xs = [x for x in v.disc if f["id"] in x["fields"]]
    assert xs and all(x["class"] == "N" and not x["to_branch2"] for x in xs)


def test_ac3_income_x12_conflict_in_branch2(validator):
    v = validator("hkd_income_x12")
    x = [x for x in v.disc if x["rule"] == "R-INCOME"]
    assert len(x) == 1
    x = x[0]
    assert (x["class"], x["subclass"], x["severity"], x["to_branch2"]) == ("C", "C1", "S2", True)
    assert x["canonical"].startswith("300.000.000/năm")
    assert x["id"] in v.branch2_context()


def test_ac4_old_card_on_marriage_certificate_is_history(validator):
    v = validator("hkd_baseline")
    f = v.facts[("P1", "id_issue_date")]
    assert f["canonical"] == "2024-08-20"
    old = [o for o in f["obs"] if o["v"] == "2021-03-01"]
    assert old and all(o["hist"] for o in old)
    assert not [x for x in v.disc if f["id"] in x["fields"] and x["class"] != "N"]


def test_ac5_self_declared_majority_does_not_beat_tier1(validator):
    v = validator("hkd_self_declared_mismatch")
    f = v.facts[("P1", "id_type")]
    self_decl = [o for o in f["obs"] if o["v"] == "CCCD" and o["tier"] >= 3]
    assert len(self_decl) >= 2
    assert f["canonical"] == "CAN_CUOC" and f["rule"].startswith("thẩm quyền")


def test_ac1_partial_cic_of_spouse_flagged(validator):
    """Phần LAC của AC-1 (cổng GĐ1 ở L8): CIC nối vào vợ/chồng, người vay chưa có CIC."""
    v = validator("hkd_cic_spouse_stale")
    x = [x for x in v.disc if x["rule"] == "R-CIC-SUBJECT"]
    assert x and x[0]["severity"] == "S1" and "chờ xác nhận" in x[0]["status"]
    assert "chưa có báo cáo CIC" in v.branch2_context()


def test_ac7_deterministic():
    assert run_case("hkd_forms_plan_role") == run_case("hkd_forms_plan_role")
