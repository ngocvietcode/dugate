"""Lớp chỉ số tính sẵn (M-*) và tín hiệu chéo vùng (T#, quy tắc R-X-*) — lac-rules §7.

Tín hiệu không phải lỗi dữ liệu: không có mức S, không chặn hồ sơ; là đầu vào cho nhánh thẩm định.
Chỉ số thiếu đầu vào -> "not_computable" kèm danh sách đầu vào thiếu, không ước lượng.
Đầu vào đang có mâu thuẫn loại C -> dùng giá trị chuẩn (thận trọng) và gắn cờ X#.
"""
from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal

from lac.graph import fmt, norm_text
from lac.validate import Validator, to_date

Q = Decimal("0.0001")


def _num(x):
    return Decimal(str(x)) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _q(d: Decimal | None):
    return float(d.quantize(Q, rounding=ROUND_HALF_EVEN)) if d is not None else None


class _Ctx:
    def __init__(self, v: Validator):
        self.v = v
        G = v.G
        self.loan = next(iter(v.cg.loans), None)
        rel = lambda r: [(u, w) for u, w, e in G.edges(data=True) if e["rel"] == r]  # noqa: E731
        self.asset = next((w for u, w in rel("SECURED_BY") if u == self.loan), None)
        self.business = next((w for u, w in rel("FOR_BUSINESS") if u == self.loan), None)
        self.plan = next((w for u, w in rel("USE_OF_FUNDS") if u == self.loan), None)

    def fact(self, entity, attr):
        return self.v.facts.get((entity, attr)) if entity else None

    def val(self, entity, attr):
        f = self.fact(entity, attr)
        if not f or f["status"] == "chưa xác định":
            return None, (f["id"] if f else None), []
        cflags = [fl.split(":")[0] for fl in f["flags"] if fl.endswith(":C")]
        return f["canonical"], f["id"], cflags


def _metric(mid, name, formula, inputs, compute):
    """inputs: [(tên, (giá trị, F#, cờ C))]"""
    missing = [n for n, (val, _, _) in inputs if _num(val) is None]
    flags = sorted({x for _, (_, _, fl) in inputs for x in fl})
    row = {"id": mid, "name": name, "formula": formula, "status": "not_computable", "value": None,
           "inputs": [{"name": n, "fact": fid, "value": float(_num(val)) if _num(val) is not None else None}
                      for n, (val, fid, _) in inputs],
           "missing": missing, "flags": flags}
    if not missing:
        try:
            row["value"] = _q(compute(*[_num(val) for _, (val, _, _) in inputs]))
            row["status"] = "computed"
        except ZeroDivisionError:
            row["missing"] = ["mẫu số bằng 0"]
    return row


def compute_metrics(v: Validator, interest_rate: float | None = None) -> list[dict]:
    c = _Ctx(v)
    amount = c.val(c.loan, "loan_info.bank_proposed_amount")
    if amount[0] is None:
        amount = c.val(c.loan, "loan_info.requested_amount")
    term = c.val(c.loan, "loan_info.loan_term_months")
    profit = c.val(c.business, "net_profit_annual")
    revenue = c.val(c.business, "net_revenue_annual")
    cogs = c.val(c.business, "cogs_annual")
    asset_value = c.val(c.asset, "asset_value")
    plan_total = c.val(c.plan, "funding_plan.total")
    existing = c.val(c.loan, "financial_info.existing_monthly_debt_payment")
    method = c.val(c.loan, "loan_info.principal_repayment_method")[0]
    bullet = "cuoi ky" in norm_text(method)
    rate = (interest_rate, "context.interestRate", [])
    years = lambda t: t / Decimal(12)  # noqa: E731

    def dscr(p, a, r, t, e):
        principal_per_year = Decimal(0) if bullet else a / years(t)
        return p / (a * r + principal_per_year + e * 12)

    out = [
        _metric("M-LTV", "LTV", "số vay / giá trị tài sản bảo đảm", [("số vay", amount), ("giá trị TSBĐ", asset_value)],
                lambda a, b: a / b),
        _metric("M-DSCR", "DSCR",
                "lợi nhuận năm / (số vay × lãi suất năm + gốc phải trả mỗi năm + nợ hiện có hàng tháng × 12); "
                "trả gốc cuối kỳ: gốc mỗi năm = 0 (xem M-BULLET)",
                [("lợi nhuận năm", profit), ("số vay", amount), ("lãi suất năm (số)", rate),
                 ("kỳ hạn tháng", term), ("nợ hiện có hàng tháng", existing)], dscr),
        _metric("M-LOAN-REVENUE", "Số vay / doanh thu năm", "số vay / doanh thu thuần năm",
                [("số vay", amount), ("doanh thu năm", revenue)], lambda a, b: a / b),
        _metric("M-PLAN-COGS", "Phương án / giá vốn năm", "tổng phương án vốn / giá vốn năm",
                [("tổng phương án", plan_total), ("giá vốn năm", cogs)], lambda a, b: a / b),
        _metric("M-MARGIN", "Biên lợi nhuận", "lợi nhuận / doanh thu cùng kỳ",
                [("lợi nhuận năm", profit), ("doanh thu năm", revenue)], lambda a, b: a / b),
    ]
    if bullet:
        out.append(_metric("M-BULLET", "Gốc cuối kỳ / lợi nhuận cả kỳ", "số vay / (lợi nhuận năm × số năm vay)",
                            [("số vay", amount), ("lợi nhuận năm", profit), ("kỳ hạn tháng", term)],
                            lambda a, p, t: a / (p * years(t))))
    return out


def compute_signals(v: Validator, metrics: list[dict]) -> list[dict]:
    c, P = _Ctx(v), v.cfg.signal_params
    m = {x["id"]: x for x in metrics}
    sig: list[dict] = []

    def add(rule, title, detail, fields=(), discs=(), mets=(), threshold=None):
        sig.append({"id": f"T{len(sig) + 1}", "rule": rule, "title": title, "detail": detail,
                    "fields": [f for f in fields if f], "discrepancies": sorted(set(discs)),
                    "metrics": list(mets), "threshold": threshold})

    # Tài sản × Quan hệ
    own = c.fact(c.asset, "ownership_form")
    spouse_edge = next((e for _, _, e in v.G.edges(data=True) if e["rel"] == "SPOUSE"), None)
    married = to_date((spouse_edge or {}).get("registration_date"))
    cert_doc = next((u for u, w, e in v.G.edges(data=True) if e["rel"] == "EVIDENCES" and w == c.asset
                     and v.cg.docs[u]["type"] == "land_use_certificate"), None)
    issued = v.doc_dates.get(cert_doc) if cert_doc else None
    if own and "rieng" in norm_text(own.get("canonical")) and married and issued and issued > married:
        add("R-X-MARITAL-ASSET", "GCN cấp sau ngày kết hôn nhưng ghi sở hữu riêng",
            f"GCN {cert_doc} cấp {issued}, kết hôn {married}, hình thức «{own['canonical']}»; ngày cấp GCN có "
            "thể là ngày cấp đổi — cần xác minh căn cứ tài sản riêng hoặc ý kiến của vợ/chồng",
            fields=[own["id"]])
    # Khoản vay × Tài sản
    ltv, cap, margin = m["M-LTV"], P["ltv_cap"], P["ltv_margin"]
    av = c.fact(c.asset, "asset_value")
    no_source = av is not None and av["status"] == "không có nguồn chứng từ"
    if ltv["status"] == "computed" and (cap - margin <= ltv["value"] <= cap or no_source):
        amount = Decimal(str(ltv["inputs"][0]["value"]))
        headroom = Decimal(str(ltv["inputs"][1]["value"])) - amount / Decimal(str(cap))
        add("R-X-LTV-MARGIN", f"LTV {ltv['value']:.2%} so với trần {cap:.0%}",
            f"giá trị tài sản thấp hơn {fmt(int(headroom))} đồng là vượt trần"
            + ("; giá trị tài sản không có chứng từ nguồn" if no_source else ""),
            fields=[i["fact"] for i in ltv["inputs"]], discs=ltv["flags"] + [x.split(":")[0] for x in (av or {}).get("flags", [])],
            mets=["M-LTV"], threshold=cap)
    # Phương án vốn × Kinh doanh
    pc = m["M-PLAN-COGS"]
    if pc["status"] == "computed" and pc["value"] > P["plan_cogs_max"]:
        area = c.val(c.business, "premises_area_m2")[0]
        prem = c.val(c.business, "premises_type_raw")[0]
        add("R-X-PLAN-COGS", f"Hàng nhập bằng {pc['value']:g} lần giá vốn cả năm",
            f"ngưỡng {P['plan_cogs_max']:g}" + (f"; mặt bằng {prem} {fmt(area)} m²" if area or prem else ""),
            fields=[i["fact"] for i in pc["inputs"]], discs=pc["flags"], mets=["M-PLAN-COGS"],
            threshold=P["plan_cogs_max"])
    # Khoản vay × Tài chính
    b = m.get("M-BULLET")
    if b and b["status"] == "computed" and b["value"] > 1:
        add("R-X-BULLET", f"Gốc trả cuối kỳ bằng {b['value']:g} lần lợi nhuận cả kỳ vay",
            "nguồn trả gốc cần làm rõ", fields=[i["fact"] for i in b["inputs"]], discs=b["flags"],
            mets=["M-BULLET"], threshold=1)
    # Khoản vay × Kinh doanh
    lr = m["M-LOAN-REVENUE"]
    if lr["status"] == "computed" and lr["value"] > P["loan_revenue_max"]:
        add("R-X-LOAN-REVENUE", f"Số vay bằng {lr['value']:g} lần doanh thu năm", f"ngưỡng {P['loan_revenue_max']:g}",
            fields=[i["fact"] for i in lr["inputs"]], discs=lr["flags"], mets=["M-LOAN-REVENUE"],
            threshold=P["loan_revenue_max"])
    # Tài chính × Khoản vay: thu nhập đang có mâu thuẫn C
    inc_c = [x["id"] for x in v.disc if x["rule"] == "R-INCOME" and x["class"] == "C"]
    if inc_c:
        add("R-X-INCOME-USE", "Chỉ số khả năng trả nợ dùng thu nhập thận trọng",
            "thu nhập đang có mâu thuẫn nội dung; DSCR và M-BULLET dùng lợi nhuận năm trên bảng kê",
            discs=inc_c, mets=[x for x in ("M-DSCR", "M-BULLET") if x in m])
    # Chỉ số × Nguồn
    for x in metrics:
        if x["status"] == "not_computable":
            add("R-X-METRIC-INPUT", f"{x['name']} chưa tính được", "thiếu: " + ", ".join(x["missing"]),
                fields=[i["fact"] for i in x["inputs"] if i["fact"] and i["fact"].startswith("F")],
                mets=[x["id"]])
    return sig


def render_branch2_extra(metrics: list[dict], signals: list[dict]) -> str:
    L = ["## Chỉ số tính sẵn"]
    for x in metrics:
        ins = ", ".join(f"{i['name']}={fmt(int(i['value'])) if i['value'] is not None and i['value'] == int(i['value']) else i['value']}"
                        + (f" [{i['fact']}]" if i["fact"] else "") for i in x["inputs"])
        val = f"{x['value']:g}" if x["status"] == "computed" else "chưa tính được (thiếu: " + ", ".join(x["missing"]) + ")"
        L.append(f"{x['id']} {x['name']} = {val} · {x['formula']} · đầu vào: {ins}"
                 + (f" ⚠ {', '.join(x['flags'])}" if x["flags"] else ""))
    L += ["", "## Tín hiệu chéo vùng (T#)"]
    for t in signals:
        L.append(f"{t['id']} {t['rule']}: {t['title']} — {t['detail']}"
                 + (f" [{', '.join(t['fields'] + t['discrepancies'] + t['metrics'])}]" if t['fields'] or t['discrepancies'] or t['metrics'] else ""))
    return "\n".join(L) + "\n"
