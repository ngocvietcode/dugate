"""Vùng Tài chính và Phương án vốn của LAC (LAC §3.1 vùng 4 và 6).

Không sinh giá trị mới: chỉ trình bày lại các F# đã chọn, kèm kỳ, giá trị quy năm và loại nguồn,
để nhánh thẩm định và chỉ số không phải tự đoán kỳ của từng con số.
"""
from __future__ import annotations

from lac.validate import Validator

PERIOD_FACTOR = {"ANNUAL": 1, "MONTHLY": 12, "QUARTERLY": 4}
BUSINESS_METRICS = {"net_revenue_annual": "revenue", "cogs_annual": "cogs", "gross_profit_annual": "gross_profit",
                    "total_cost_annual": "total_cost", "net_profit_annual": "net_profit"}


def _source_type(v: Validator, docs: list[str]) -> str | None:
    types = {v.cfg.source_types.get(v.dtype(d), "OTHER") for d in docs if d in v.cg.docs}
    return types.pop() if len(types) == 1 else ("MIXED" if types else None)


def _row(v, f, metric, period):
    annual = f["canonical"] * PERIOD_FACTOR[period] if isinstance(f["canonical"], (int, float)) and period in PERIOD_FACTOR else None
    return {"entity": f["entity"], "metric": metric, "fact": f["id"], "value": f["canonical"], "period": period,
            "annualized": annual, "source_type": _source_type(v, f["sources"]), "sources": list(f["sources"]),
            "flags": list(f["flags"])}


def financials(v: Validator) -> list[dict]:
    out = []
    for (ent, attr), f in v.facts.items():
        if f["canonical"] is None:
            continue
        if attr in BUSINESS_METRICS:
            out.append(_row(v, f, BUSINESS_METRICS[attr], "ANNUAL"))
    for lid in v.cg.loans:
        f = v.facts.get((lid, "financial_info.total_income"))
        per = v.facts.get((lid, "financial_info.total_income_period"))
        if f and f["canonical"] is not None:
            out.append(_row(v, f, "declared_income", (per or {}).get("canonical") or "UNKNOWN"))
        debt = v.facts.get((lid, "financial_info.existing_monthly_debt_payment"))
        if debt and debt["canonical"] is not None:
            out.append(_row(v, debt, "existing_debt_payment", "MONTHLY"))
    return out


def funding_plans(v: Validator) -> list[dict]:
    out = []
    for gid in v.cg.plans:
        x = v.G.nodes[gid]
        items = [{"no": it.get("item_no"), "name": it.get("item_name"), "unit": it.get("unit"),
                  "quantity": it.get("quantity"), "unit_price": it.get("unit_price"), "amount": it.get("amount")}
                 for it in x["items"]]
        total = v.facts.get((gid, "funding_plan.total"))
        loan = next((u for u, w, e in v.G.edges(data=True) if e["rel"] == "USE_OF_FUNDS" and w == gid), None)
        out.append({"id": gid, "loan": loan, "total_fact": total["id"] if total else None,
                    "total": x["total"], "items_sum": sum((i["amount"] or 0) for i in items),
                    "items": items, "sources": [x["src"]], "source_type": _source_type(v, [x["src"]])})
    return out
