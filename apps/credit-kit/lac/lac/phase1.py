"""Giai đoạn 1 · Consistency: mỗi mục checklist phải đúng loại, đúng người, còn hiệu lực (LAC §4).

Chạy trên graph đã dựng (gán người bằng điểm bằng chứng), nên "đúng người" dùng cùng liên kết với GĐ2.
Kết quả theo contracts/lac.schema.json#/$defs/phase1.
"""
from __future__ import annotations

from lac.validate import Validator, to_date

PRINCIPAL_ROLES = ("HOLDER", "BORROWER", "CUSTOMER")
SUBJECT_VI = {"borrower": "người vay", "spouse": "vợ/chồng người vay", "collateral": "tài sản bảo đảm"}


def _spouse(v: Validator):
    b = v.borrower
    for u, w, e in v.G.edges(data=True):
        if e["rel"] == "SPOUSE" and b in (u, w):
            return w if u == b else u
    return None


def _collateral(v: Validator) -> set:
    return {w for _, w, e in v.G.edges(data=True) if e["rel"] == "SECURED_BY"}


def _doc_subjects(v: Validator, code: str) -> list[tuple[str, str]]:
    """[(party, confidence)] chứng từ nói về. Ưu tiên người ở vai trò chính (chủ thẻ, người vay)."""
    ms = [m for m in v.cg.mentions if m["doc"] == code]
    principal = [m for m in ms if m["role"] in PRINCIPAL_ROLES]
    return [(m["party"], m["confidence"]) for m in (principal[:1] or ms)]


def _expired(v: Validator, code: str) -> str | None:
    doc = v.cg.docs[code]
    rule = v.cfg.validity.get(doc["type"]) or {}
    d = v.doc_dates.get(code)
    if rule.get("max_age_days") is not None and d and (v.ref - d).days > rule["max_age_days"]:
        return f"{code} lập {d}, đã {(v.ref - d).days} ngày (hiệu lực {rule['max_age_days']} ngày)"
    if rule.get("valid_until"):
        until = to_date((doc["data"].get("legal_info") or {}).get("valid_until"))
        if until and until < v.ref:
            return f"{code} hết hạn {until}"
    return None


def phase1_gate(v: Validator) -> dict:
    spouse, collateral = _spouse(v), _collateral(v)
    want = {"borrower": v.borrower, "spouse": spouse}
    items = []
    for it in v.cfg.checklist:
        subj = it["subject"]
        cands = [c for c, doc in v.cg.docs.items() if doc["type"] in it["accept"]]
        row = {"key": it["key"], "group": it["group"], "required": bool(it["required"]), "status": "PASS",
               "docs": [], "reasons": [], "subject": want.get(subj)}
        items.append(row)
        if subj == "spouse" and spouse is None:
            row["reasons"].append("không áp dụng: hồ sơ không có vợ/chồng người vay")
            continue
        if not cands:
            row["status"] = "MISSING"
            row["reasons"].append(f"không có chứng từ loại {', '.join(it['accept'])}")
            continue
        right, review = [], []
        for c in cands:
            if subj == "collateral":
                ok = any(e["rel"] == "EVIDENCES" and w in collateral for _, w, e in v.G.out_edges(c, data=True))
                if not ok:
                    row["reasons"].append(f"{c} không gắn với tài sản bảo đảm của khoản vay")
                    continue
                right.append(c)
                continue
            if subj == "none":
                right.append(c)
                continue
            target = want[subj]
            subs = _doc_subjects(v, c)
            hit = [conf for p, conf in subs if p == target]
            if hit:
                right.append(c)
                if hit[0] != "cao":
                    review.append(c)
            else:
                who = ", ".join(sorted({p for p, _ in subs})) or "chưa xác định"
                weak = any(conf != "cao" for _, conf in subs)
                row["reasons"].append(f"{c} thuộc {who}, cần của {SUBJECT_VI[subj]} {target}"
                                      + (" (liên kết mức trung bình: xác nhận nếu thực ra là của "
                                         f"{SUBJECT_VI[subj]})" if weak else ""))
        valid = []
        for c in right:
            exp = _expired(v, c)
            if exp:
                row["reasons"].append(exp)
            else:
                valid.append(c)
        row["docs"] = valid
        if not valid:
            row["status"] = "MISSING"
        elif any(c in review for c in valid) and not [c for c in valid if c not in review]:
            row["status"] = "REVIEW"
            row["reasons"].append("liên kết chứng từ với người ở mức trung bình: cần người xác nhận")
    status = "INCOMPLETE" if any(r["required"] and r["status"] == "MISSING" for r in items) else "COMPLETE"
    return {"status": status, "items": items}
