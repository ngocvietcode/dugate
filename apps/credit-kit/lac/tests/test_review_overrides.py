"""Áp quyết định nhánh 1 vào LAC (lac.review)."""
from conftest import FIXTURES, REF_DATE
from lac.export import build_lac
from lac.graph import load


def lac(name, overrides=None):
    return build_lac(load(FIXTURES / f"{name}.json"), REF_DATE, overrides=overrides)


def by_rule(l, rule):
    return [x for x in l["discrepancies"] if x["rule"] == rule]


def test_keys_stable_across_rebuilds():
    a, b = lac("hkd_forms_plan_role"), lac("hkd_forms_plan_role")
    assert [x["key"] for x in a["discrepancies"]] == [x["key"] for x in b["discrepancies"]]
    assert len({x["key"] for x in a["discrepancies"]}) == len(a["discrepancies"])


def test_correct_value_updates_canonical_and_keeps_observation():
    """Nhánh 1 đọc lại ảnh đơn vay thấy ghi "/năm": giá trị chuẩn đổi, giá trị đọc được vẫn giữ."""
    base = lac("hkd_income_x12")
    assert by_rule(base, "R-INCOME")
    l = lac("hkd_income_x12", {"facts": [{"entity": "L1", "field": "financial_info.total_income_period",
                                          "value": "ANNUAL", "doc": "D6", "reason": "ảnh ghi /năm", "by": "cv02"}]})
    f = next(f for f in l["facts"] if f["entity"] == "L1" and f["field"] == "financial_info.total_income_period")
    assert f["value"] == "ANNUAL" and f["rule"].startswith("xác nhận bởi người")
    assert any(o["value"] == "MONTHLY" for o in f["observations"])  # giá trị đọc được vẫn giữ
    # rule_income đọc attrs của node khoản vay (dữ liệu chứng từ), không đọc fact: mâu thuẫn còn đó
    # -> nhánh 1 phải phân loại lại X# (xem test dưới); sửa fact chỉ đổi giá trị chuẩn dùng cho chỉ số.


def test_reclassify_c_to_a_removes_from_branch2():
    base = lac("hkd_income_x12")
    x = by_rule(base, "R-INCOME")[0]
    assert x["to_branch2"]
    l = lac("hkd_income_x12", {"discrepancies": [{"key": x["key"], "class": "A", "reason": "lỗi bóc tách kỳ (A3)",
                                                  "by": "cv02"}]})
    y = by_rule(l, "R-INCOME")[0]
    assert (y["class"], y["to_branch2"], y["severity"]) == ("A", False, "S3")
    assert "phân loại lại bởi người" in y["status"]
    assert l["stats"]["to_branch2"] == base["stats"]["to_branch2"] - 1


def test_confirm_spouse_cic_link_and_reject_link():
    base = lac("hkd_cic_spouse_stale")
    cic_doc = next(d["id"] for d in base["documents"] if d["doc_type"] == "cic")
    m = next(m for m in base["mentions"] if m["doc"] == cic_doc)
    assert m["party"] == "P2" and m["confidence"] == "trung bình"
    ok = lac("hkd_cic_spouse_stale", {"links": [{"doc": cic_doc, "idx": 0, "party": "P2", "reason": "đối chiếu ảnh", "by": "cv02"}]})
    m2 = next(m for m in ok["mentions"] if m["doc"] == cic_doc)
    assert m2["confidence"] == "cao" and m2["party"] == "P2"
    x = by_rule(ok, "R-CIC-SUBJECT")[0]
    assert x["status"] == "chốt theo quy tắc"
    rej = lac("hkd_cic_spouse_stale", {"links": [{"doc": cic_doc, "idx": 0, "party": None, "reason": "không rõ", "by": "cv02"}]})
    m3 = next(m for m in rej["mentions"] if m["doc"] == cic_doc)
    assert m3["party"].startswith("U") and rej["stats"]["unresolved_mentions"] == 1
