"""Áp quyết định của nhánh 1 (soát dữ liệu) vào LAC một cách tất định (spec 002 FR-17, FR-25).

overrides = {
  "facts":         [{"entity": "L1", "field": "financial_info.total_income_period", "value": "ANNUAL",
                     "doc": "D5", "reason": "...", "by": "cv02"}],          # sửa giá trị sau khi đọc lại ảnh (lỗi A)
  "discrepancies": [{"key": "<disc key>", "class": "A" | "B" | "C", "reason": "...", "by": "cv02"}],
  "links":         [{"doc": "D11", "idx": 0, "party": "P1" | null, "reason": "...", "by": "cv02"}],
}
Giá trị đọc được trên chứng từ vẫn giữ trong observations (lac-rules §1.1); override là một lớp bên trên có ghi người
và lý do. Cùng đầu vào + cùng overrides -> cùng LAC.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from lac.graph import CaseGraph
from lac.validate import Validator, severity

HUMAN = "xác nhận bởi người"


def disc_key(rule: str, fields: list[str], title: str) -> str:
    """Khoá ổn định của một sai lệch qua các lần dựng lại (X# có thể đổi số khi sắp xếp lại)."""
    return hashlib.sha1(f"{rule}|{','.join(fields)}|{title}".encode()).hexdigest()[:12]


class ReviewedCaseGraph(CaseGraph):
    links: dict = {}

    def _resolve_mentions(self):
        """Áp liên kết người đã được xác nhận/bác TRƯỚC vòng gán tự động; vòng tự động bỏ qua các lần nhắc này."""
        for mt in self.mentions:
            o = self.links.get((mt["doc"], mt["idx"]))
            if o is None:
                continue
            note = [f"{HUMAN}: {o.get('by')} — {o.get('reason')}"]
            if o.get("party"):
                mt.update(party=o["party"], score=None, confidence="cao", against=[], evidence=note)
                if o["party"] in self.profiles:
                    self._absorb(mt, o["party"])
            else:  # liên kết bị bác: thành người chưa xác định, không đoán lại
                self.unresolved += 1
                uid = f"U{self.unresolved}"
                self.G.add_node(uid, kind="party", entity_type="UNRESOLVED", name=None, national_id=None,
                                obs=defaultdict(list), roles=[])
                mt.update(party=uid, score=None, confidence="không xác định", against=[], evidence=note)
        super()._resolve_mentions()


class ReviewedValidator(Validator):
    def __init__(self, data, ref_date, cic_max_age=None, config=None, overrides=None):
        o = overrides or {}
        self._fact_o = {(x["entity"], x["field"]): x for x in o.get("facts", [])}
        self._disc_o = {x["key"]: x for x in o.get("discrepancies", [])}
        links = {(x["doc"], x["idx"]): x for x in o.get("links", [])}
        self.graph_cls = type("BoundReviewedCaseGraph", (ReviewedCaseGraph,), {"links": links})
        super().__init__(data, ref_date, cic_max_age, config)

    def choose(self, f):
        super().choose(f)
        o = self._fact_o.get((f["entity"], f["attr"]))
        if o is None:
            return
        f["obs"].append({"v": o["value"], "doc": o.get("doc") or "review", "tier": 0,
                         "note": f"{HUMAN}: {o.get('by')} — {o.get('reason')}", "hist": False})
        f["canonical"] = o["value"]
        from lac.graph import value_key
        f["canonical_key"] = value_key(f["attr"], o["value"])
        f["status"], f["rule"] = "ok", f"{HUMAN} ({o.get('by')})"
        f["sources"] = [o.get("doc") or "review"]

    def add(self, rule, cls, sub, k, fields, title, detail="", obs=None, canonical=None,
            resolved=True, sev=None, note=None, status=None):
        o = self._disc_o.get(disc_key(rule, fields, title))
        if o and o.get("class") and o["class"] != cls:
            new = o["class"]
            sub = {"A": "A", "B": "B", "C": "C"}[new] + (sub[1:] if sub[:1] == new else "0")
            cls, sev = new, severity(new, k, self.cfg)
            status = f"phân loại lại bởi người ({o.get('by')}): {o.get('reason')}"
        super().add(rule, cls, sub, k, fields, title, detail, obs, canonical, resolved, sev, note, status)
