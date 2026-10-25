#!/usr/bin/env python3
"""
Lớp rule chỉ dựa trên JSON (chưa đọc ảnh) cho hồ sơ vay schema dugate 5.0.

  1. Dựng graph bằng lac.graph.CaseGraph.
  2. Chọn giá trị chuẩn cho từng field: chuẩn hoá -> hiệu lực thời gian -> thẩm quyền -> đa số nguồn độc lập.
  3. Chạy rule, phát hiện điểm lệch, phân loại sơ bộ N / A / B / C, xếp mức S1–S4.
  4. Xuất:
       facts.json            giá trị chuẩn, mỗi field một ID F#
       discrepancies.json    danh sách điểm lệch (X#)
       discrepancies.md      bản đọc cho nhánh 1
       branch2_context.md    ngữ cảnh cho nhánh thẩm định: chỉ giá trị chuẩn + mâu thuẫn loại C

Không có ảnh nên:
  - A và B không tách được khi cùng có thể xảy ra -> ghi "A|B", trạng thái "chờ xác nhận".
  - C là sơ bộ (nghi ngờ thì xếp C). Nhánh 1 có thể hạ loại khi có ảnh.

Dùng:  python -m lac.validate case.json -o out/ [--ref-date 2026-10-23] [--cic-max-age 30]
"""
from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict, defaultdict
from datetime import date
from pathlib import Path

from lac.config import Config, load_config
from lac.graph import (CaseGraph, OneOf, approx_tokens, flatten, fmt, is_address,
                       jsonable, load, norm_id, norm_text, strip_accents, value_key)

# ============================================================================ CẤU HÌNH QUY TẮC
# Hằng số quy tắc nằm trong apps/credit-kit/config/<product>/<version>/*.yaml (lac.config).

# ============================================================================ helpers

def crit(attr: str, cfg: Config) -> str:
    if attr in cfg.k1 or attr.startswith(cfg.k1_prefixes):
        return "K1"
    if attr in cfg.k2:
        return "K2"
    return "K3"


def severity(cls: str, k: str, cfg: Config, resolved=True) -> str:
    if cls == "N":
        return "S4"
    vals = []
    for part in cls.split("|"):
        s = cfg.severity_base[part][k]
        if part == "A" and k == "K2" and not resolved:
            s = "S2"
        vals.append(s)
    return min(vals, key=cfg.severity_order.index)


def to_date(s) -> date | None:
    if not s or not isinstance(s, str):
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def expand(s, cfg: Config) -> str:
    t = norm_text(s)
    for pat, rep in cfg.abbrev:
        t = pat.sub(rep, t)
    return t


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def strip_honorific(s: str) -> str:
    return re.sub(r"^(bà|ông|anh|chị|bà\.|ông\.)\s+", "", (s or "").strip(), flags=re.I)


# ============================================================================ validator

class Validator:
    graph_cls = CaseGraph  # lớp con (lac.review) thay để áp xác nhận của người cho liên kết

    def __init__(self, data: dict, ref_date: date | None, cic_max_age: int | None = None,
                 config: Config | None = None):
        self.cfg = config or load_config()
        self.cg = self.graph_cls(data, self.cfg)
        self.G = self.cg.build()
        self.d = data
        c = data.get("case", {})
        self.ref = ref_date or to_date(c.get("completed_at")) or date.today()
        self.cic_max_age = cic_max_age if cic_max_age is not None else self.cfg.cic_max_age_days
        self.facts: "OrderedDict[tuple, dict]" = OrderedDict()
        self.disc: list[dict] = []
        self.doc_dates = {code: self._doc_date(doc) for code, doc in self.cg.docs.items()}
        self.borrower = next((u for u, _, e in self.G.edges(data=True) if e["rel"] == "APPLIES_FOR"), None)

    # ---------------------------------------------------------------- dữ liệu nền
    def _doc_date(self, doc):
        data = doc["data"]
        li = data.get("legal_info") or {}
        for v in (li.get("issue_date"), data.get("registration_date")):
            if to_date(v):
                return to_date(v)
        for rep in data.get("reports") or []:
            if rep and to_date(rep.get("report_datetime")):
                return to_date(rep["report_datetime"])
        for s in li.get("signatories") or []:
            if s and to_date(s.get("sign_date")):
                return to_date(s["sign_date"])
        return None

    def dtype(self, code):
        return self.cg.docs[code]["type"] if code in self.cg.docs else code

    def tier(self, group, code, override=None):
        if override is not None:
            return override
        return self.cfg.tiers.get(group, {}).get(self.dtype(code), self.cfg.default_tier)

    def add_fact(self, entity, attr, group, value, code, tier=None, note=None):
        key = (entity, attr)
        f = self.facts.get(key)
        if f is None:
            f = self.facts[key] = {"entity": entity, "attr": attr, "group": group, "obs": [],
                                   "flags": [], "status": "ok"}
        f["obs"].append({"v": value, "doc": code, "tier": self.tier(group, code, tier), "note": note})

    def collect(self):
        G = self.G
        # người
        for n, x in G.nodes(data=True):
            if x.get("kind") != "party":
                continue
            if x.get("name"):
                self.add_fact(n, "name", "identity", x["name"], "case.parties", tier=9,
                              note="tên lấy từ case.parties, bản ghi chứng từ không có họ tên")
            for attr, obs in x["obs"].items():
                group = self.cfg.party_field_groups.get(attr, "other")
                for v, code in obs:
                    self.add_fact(n, attr, group, v, code)
        for mt in self.cg.mentions:
            doc = self.cg.docs[mt["doc"]]
            if doc["type"] == "id_card" and mt["idx"] == 0:
                li = doc["data"].get("legal_info") or {}
                if li.get("document_number"):
                    self.add_fact(mt["party"], "national_id", "identity", li["document_number"], mt["doc"])
                t = norm_text(li.get("document_title"))
                if t in ("can cuoc", "can cuoc cong dan"):
                    self.add_fact(mt["party"], "id_type", "id_doc", "CAN_CUOC" if t == "can cuoc" else "CCCD",
                                  mt["doc"], tier=0, note="suy từ tiêu đề mặt thẻ")
                if li.get("issuing_authority"):
                    self.add_fact(mt["party"], "id_issue_place", "id_doc", li["issuing_authority"], mt["doc"],
                                  tier=0, note="cơ quan cấp in trên thẻ")
        # hộ kinh doanh
        for b in self.cg.businesses:
            for attr, obs in G.nodes[b]["obs"].items():
                a = self.cfg.business_synonyms.get(attr, attr)
                group = "income" if a in self.cfg.income_attrs else "business"
                for v, code in obs:
                    self.add_fact(b, a, group, v, code)
        # tài sản
        for n, x in G.nodes(data=True):
            if x.get("kind") != "asset":
                continue
            for attr, obs in x["obs"].items():
                for v, code in obs:
                    self.add_fact(n, attr, "asset", v, code)
            for u, v, e in G.in_edges(n, data=True):
                if e["rel"] == "SECURED_BY":
                    num = e.get("matched_by", "").replace("số GCN ", "")
                    self.add_fact(n, "identifiers.certificate_number", "asset", num, e["src"][0])
            if x.get("case_value") is not None:
                self.add_fact(n, "asset_value", "asset", x["case_value"], "case.assets", tier=9,
                              note="không có trong bản ghi chứng từ nào")
        # khoản vay
        for lid in self.cg.loans:
            x = G.nodes[lid]
            for k, v in x["attrs"].items():
                self.add_fact(lid, k, "loan", v, x["src"])
        # phương án vốn
        for gid in self.cg.plans:
            x = G.nodes[gid]
            self.add_fact(gid, "funding_plan.total", "plan", x["total"], x["src"])
        # CIC
        for code, subj, rep in self.cg.cic:
            for p, v in flatten({k: v for k, v in rep.items() if k != "queried_institutions"}):
                self.add_fact(f"CIC@{code}", p, "credit", v, code)

    # ---------------------------------------------------------------- chọn giá trị chuẩn
    def anchor(self, f):
        """Mốc thời gian để xét 'giá trị cũ' cho thuộc tính giấy tờ: ngày cấp của giấy tờ hiện tại."""
        if f["group"] == "id_doc":
            g = self.facts.get((f["entity"], "id_issue_date"))
            if g and g.get("canonical") and to_date(g["canonical"]):
                return to_date(g["canonical"])
        return None

    def is_hist(self, f, o):
        if f["attr"] not in self.cfg.temporal_attrs:
            return False
        d = self.doc_dates.get(o["doc"])
        if d is None:
            return False
        if f["attr"] == "id_issue_date":
            # chứng từ lập trước ngày cấp giấy tờ hiện tại -> ghi giấy tờ cũ
            return to_date(f.get("_tier_best")) is not None and d < to_date(f["_tier_best"])
        anc = self.anchor(f)
        if anc:
            return d < anc
        return (self.ref - d).days > self.cfg.stale_days

    def choose(self, f):
        attr = f["attr"]
        key = lambda v: value_key(attr, v)  # noqa: E731
        plain = [o for o in f["obs"] if not isinstance(o["v"], OneOf) and o["v"] not in (None, "")]
        if attr == "id_issue_date" and plain:
            best = min(o["tier"] for o in plain)
            f["_tier_best"] = next(o["v"] for o in plain if o["tier"] == best)
        for o in f["obs"]:
            o["hist"] = self.is_hist(f, o)
        current = [o for o in plain if not o["hist"]]
        pool = current or plain
        f["canonical"], f["canonical_key"], f["rule"] = None, None, None
        if pool:
            best = min(o["tier"] for o in pool)
            cands = OrderedDict()
            for o in pool:
                if o["tier"] == best:
                    cands.setdefault(key(o["v"]), []).append(o)
            if len(cands) == 1:
                ck = next(iter(cands))
                f["rule"] = "thẩm quyền (in trên mặt thẻ)" if best == 0 else f"thẩm quyền (bậc {best:g})"
            else:
                votes = {k: len({self.cfg.source_groups.get(self.dtype(o["doc"]), o["doc"])
                                 for o in pool if key(o["v"]) == k}) for k in cands}
                top = max(votes.values())
                win = [k for k, c in votes.items() if c == top]
                if len(win) == 1:
                    ck, f["rule"] = win[0], f"đa số nguồn độc lập trong bậc {best:g}"
                elif all(isinstance(cands[k][0]["v"], (int, float)) for k in win):
                    ck = min(win, key=lambda k: cands[k][0]["v"])
                    f["rule"] = "nguồn cùng bậc lệch nhau, lấy giá trị thận trọng"
                else:
                    ck = None
                    f["status"] = "chưa xác định"
                    f["rule"] = f"các nguồn bậc {best:g} lệch nhau, không có đa số"
            if ck is not None:
                grp = [o for o in pool if key(o["v"]) == ck]
                rep = max(grp, key=lambda o: (-o["tier"], len(fmt(o["v"]))))
                f["canonical"], f["canonical_key"] = rep["v"], ck
                # chỉ có nguồn tự khai nhưng chứng từ cũ ghi khác -> chưa xác minh được giá trị hiện tại
                if attr in self.cfg.temporal_attrs and best >= 3 and any(o["hist"] and key(o["v"]) != ck for o in plain):
                    f["status"] = "chưa xác định"
                    f["rule"] = "giá trị hiện tại chỉ có nguồn tự khai, chứng từ cũ ghi khác"
        # chỉ có giá trị nhiều ứng viên
        oneofs = [o for o in f["obs"] if isinstance(o["v"], OneOf)]
        if f["canonical"] is None and f["status"] == "ok" and oneofs:
            cands = list(oneofs[0]["v"])
            norm = [norm_text(c) for c in cands]
            longest = max(range(len(cands)), key=lambda i: len(norm[i]))
            if all(n in norm[longest] for n in norm):
                f["canonical"] = cands[longest]
                f["canonical_key"] = key(cands[longest])
                f["rule"] = "các ứng viên chứa nhau, lấy bản đầy đủ nhất"
            else:
                f["status"] = "chưa xác định"
                f["rule"] = "chỉ có giá trị nhiều ứng viên"
        if all(o["tier"] >= 9 for o in f["obs"]) and f["canonical"] is not None:
            f["status"] = "không có nguồn chứng từ"
        if f["status"] == "chưa xác định":
            f["sources"] = []
            return
        if oneofs and f["rule"] and "chứa nhau" in f["rule"]:
            f["sources"] = sorted({o["doc"] for o in oneofs}, key=_doc_sort)
            return
        f["sources"] = sorted({o["doc"] for o in f["obs"]
                               if f["canonical_key"] is not None and not isinstance(o["v"], OneOf)
                               and key(o["v"]) == f["canonical_key"]}, key=_doc_sort)

    # ---------------------------------------------------------------- điểm lệch
    def add(self, rule, cls, sub, k, fields, title, detail="", obs=None, canonical=None,
            resolved=True, sev=None, note=None, status=None):
        status = status or ("tự đóng" if cls == "N" else
                  "chờ xác nhận (cần ảnh hoặc người)" if "|" in cls or cls == "C" or (cls == "A" and not resolved)
                  else "chốt theo quy tắc")
        self.disc.append({
            "rule": rule, "class": cls, "subclass": sub, "criticality": k,
            "severity": sev or severity(cls, k, self.cfg, resolved), "fields": fields, "title": title,
            "detail": detail, "observations": obs or [], "canonical": canonical,
            "status": status, "to_branch2": cls == "C", "note": note})

    def obs_view(self, f, os_):
        out = defaultdict(list)
        for o in os_:
            out[fmt(o["v"])].append(o["doc"])
        return [{"value": v, "docs": sorted(set(d), key=_doc_sort)} for v, d in out.items()]

    def cross_source(self, f):
        attr, fid = f["attr"], f["id"]
        key = lambda v: value_key(attr, v)  # noqa: E731
        k = crit(attr, self.cfg)
        canon = f["canonical"]
        if f["status"] == "chưa xác định" and len(f["obs"]) > 1:
            cls, sub = ("B", "B6") if f["group"] in ("identity", "id_doc", "residence", "marital") else ("C", "C1")
            self.add("R-CROSS", cls, sub, k, [fid], f"{f['entity']}.{attr}: không chọn được giá trị chuẩn",
                     f["rule"], self.obs_view(f, f["obs"]),
                     note="thiếu nguồn bậc 1 để xác minh" if cls == "B" else None)
            return
        # biến thể cách viết của chính giá trị chuẩn
        same = [o for o in f["obs"] if not isinstance(o["v"], OneOf) and o["v"] is not None
                and f["canonical_key"] is not None and key(o["v"]) == f["canonical_key"]]
        if len({fmt(o["v"]) for o in same}) > 1:
            self.add("R-NORM", "N", "N", k, [fid], f"{f['entity']}.{attr}: {len({fmt(o['v']) for o in same})} cách viết cùng giá trị",
                     "bằng nhau sau chuẩn hoá", self.obs_view(f, same), fmt(canon))
        if f["canonical_key"] is None:
            return
        # các nhóm khác giá trị chuẩn
        groups = OrderedDict()
        for o in f["obs"]:
            if isinstance(o["v"], OneOf) or o["v"] is None or key(o["v"]) == f["canonical_key"]:
                continue
            groups.setdefault((key(o["v"]), o["hist"], o["tier"] <= 1), []).append(o)
        for (vk, hist, t1), os_ in groups.items():
            v = os_[0]["v"]
            docs = ",".join(sorted({o["doc"] for o in os_}, key=_doc_sort))
            title = f"{f['entity']}.{attr}: {docs} ghi «{fmt(v)}», giá trị chuẩn «{fmt(canon)}»"
            ov = self.obs_view(f, os_)
            if hist:
                self.add("R-CROSS", "N", "N", k, [fid], title, "giá trị cũ trên chứng từ thuộc thời kỳ trước", ov, fmt(canon))
            elif isinstance(v, str) and isinstance(canon, str) and (expand(v, self.cfg) in expand(canon, self.cfg) or expand(canon, self.cfg) in expand(v, self.cfg)):
                self.add("R-CROSS", "N", "N", k, [fid], title, "viết tắt hoặc rút gọn của cùng giá trị", ov, fmt(canon))
            elif t1:
                self.add("R-CROSS", "A", "A4", k, [fid], title,
                         "giấy tờ nhà nước bậc 1 ghi khác: nghi lỗi bóc tách", ov, fmt(canon))
            elif f["group"] == "id_doc":
                self.add("R-CROSS", "A|B", "B4", k, [fid], title,
                         "thông tin giấy tờ trên chứng từ không khớp giấy tờ gốc", ov, fmt(canon))
            elif isinstance(v, str) and isinstance(canon, str) and ("number" in attr or attr.endswith("_id")) \
                    and len(norm_id(v)) == len(norm_id(canon)) and lev(norm_id(v), norm_id(canon)) <= 2:
                self.add("R-CROSS", "A|B", "A1", k, [fid], title, "mã số lệch tối đa 2 ký tự", ov, fmt(canon))
            elif isinstance(v, str) and isinstance(canon, str) and norm_text(v) == norm_text(canon):
                self.add("R-CROSS", "A|B", "B1", k, [fid], title, "chỉ khác dấu", ov, fmt(canon))
            elif to_date(v) and to_date(canon) and to_date(v).day == to_date(canon).month \
                    and to_date(v).month == to_date(canon).day:
                self.add("R-CROSS", "A|B", "A2", k, [fid], title, "đảo ngày và tháng", ov, fmt(canon))
            else:
                self.add("R-CROSS", "C", "C1", k, [fid], title, "khác nghĩa giữa các nguồn", ov, fmt(canon))
        # ô nhiều ứng viên
        for o in f["obs"]:
            if not isinstance(o["v"], OneOf):
                continue
            hit = any(key(c) == f["canonical_key"] for c in o["v"])
            title = f"{f['entity']}.{attr}: {o['doc']} trích ra nhiều ứng viên {fmt(o['v'])}"
            if hit:
                self.add("R-ONEOF", "A", "A5" if f["rule"] and "chứa nhau" in f["rule"] else "A4", k, [fid], title,
                         f"chọn «{fmt(canon)}» theo {f['rule']}", [{"value": fmt(o['v']), "docs": [o['doc']]}], fmt(canon))
            else:
                self.add("R-ONEOF", "A", "A4", k, [fid], title, "không ứng viên nào khớp giá trị chuẩn",
                         [{"value": fmt(o['v']), "docs": [o['doc']]}], fmt(canon), resolved=False)

    # ---------------------------------------------------------------- rule đặc thù
    def fid(self, entity, attr):
        f = self.facts.get((entity, attr))
        return f["id"] if f else f"{entity}.{attr}"

    def rule_income(self):
        for lid in self.cg.loans:
            a = self.G.nodes[lid]["attrs"]
            inc, per = a.get("financial_info.total_income"), a.get("financial_info.total_income_period")
            if not inc or not per:
                continue
            annual = inc * 12 if per == "MONTHLY" else inc
            for _, b, e in self.G.out_edges(lid, data=True):
                if e["rel"] != "FOR_BUSINESS":
                    continue
                f = self.facts.get((b, "net_profit_annual"))
                if not f or not f.get("canonical"):
                    continue
                stmt = f["canonical"]
                ratio = annual / stmt
                if abs(ratio - 1) <= self.cfg.fin_tolerance:
                    continue
                note = ("đúng hệ số 12: có thể là lỗi bóc tách kỳ (A3); chưa có ảnh nên giữ C" if
                        abs(ratio - 12) < 0.01 or abs(ratio - 1 / 12) < 0.001 else None)
                self.add("R-INCOME", "C", "C1", "K2",
                         [self.fid(lid, "financial_info.total_income"), f["id"]],
                         f"Thu nhập: đơn vay {fmt(inc)}/{per} (= {fmt(annual)}/năm), bảng kê lợi nhuận {fmt(stmt)}/năm",
                         f"lệch {ratio:g} lần",
                         [{"value": f"{fmt(inc)} {per}", "docs": [self.G.nodes[lid]['src']]},
                          {"value": f"{fmt(stmt)} ANNUAL", "docs": f["sources"]}],
                         f"{fmt(min(annual, stmt))}/năm (giá trị thận trọng, bảng kê đứng trước đơn vay)", note=note)

    def rule_roles(self):
        roles = defaultdict(lambda: defaultdict(list))
        for mt in self.cg.mentions:
            t = self.cg.docs[mt["doc"]]["type"]
            if t in self.cfg.loan_docs and mt["role"] in self.cfg.role_canon:
                roles[mt["party"]][self.cfg.role_canon[mt["role"]]].append(mt["doc"])
        for p, rs in roles.items():
            if len(rs) > 1:
                canon = next((r for r, ds in rs.items()
                              if any(self.cg.docs[d]["type"] == "loan_application" for d in ds)), None)
                self.add("R-ROLE", "C", "C2", "K2", [f"{p}.role"],
                         f"{p}: vai trò khác nhau giữa các chứng từ: " + "; ".join(f"{r} [{','.join(d)}]" for r, d in rs.items()),
                         "vai trò quyết định nghĩa vụ và bộ chứng từ bắt buộc",
                         [{"value": r, "docs": d} for r, d in rs.items()],
                         f"{canon} (giấy đề nghị vay là bậc 1 cho đề nghị vay)" if canon else None)

    def rule_cic(self):
        for code, subj, rep in self.cg.cic:
            mt = next((m for m in self.cg.mentions if m["doc"] == code), None)
            if self.borrower and subj != self.borrower:
                ev = ", ".join(mt["evidence"]) if mt else ""
                ag = "; ".join(f"{p}: {', '.join(r)}" for p, r in (mt["against"] if mt else []) if r)
                self.add("R-CIC-SUBJECT", "B", "B6", "K1", [f"CIC@{code}.subject"],
                         f"Báo cáo CIC {code} thuộc {subj}, không phải người vay {self.borrower}; người vay chưa có CIC",
                         f"liên kết {mt['confidence'] if mt else '?'}: {ev}" + (f" · loại {ag}" if ag else ""),
                         canonical=f"CIC gắn cho {subj}", sev="S1",
                         note="mức liên kết trung bình: cần người xác nhận" if mt and mt["confidence"] != "cao" else None,
                         status="chờ xác nhận (liên kết danh tính mức trung bình)"
                         if mt and mt["confidence"] != "cao" else None)
            d = to_date(rep.get("report_datetime")) or self.doc_dates.get(code)
            if d and (self.ref - d).days > self.cic_max_age:
                self.add("R-CIC-AGE", "B", "B5", "K1", [self.fid(f"CIC@{code}", "report_datetime")],
                         f"CIC {code} lập {d}, đã {(self.ref - d).days} ngày tính đến {self.ref}",
                         f"vượt {self.cic_max_age} ngày (tham số mặc định, chờ QLRR chốt)", sev="S1")
            bad = [q for q in rep.get("queried_institutions") or []
                   if q and d and to_date(q.get("query_date")) and to_date(q["query_date"]) > d]
            if bad:
                self.add("R-DATE", "A|B", "A2", "K3", [f"CIC@{code}.queried_institutions"],
                         f"{len(bad)} lượt tra cứu CIC có ngày sau ngày lập báo cáo {d}",
                         "; ".join(f"{q['institution']} {q['query_date']}" for q in bad))

    def rule_id_structure(self):
        for n, x in self.G.nodes(data=True):
            if x.get("kind") != "party":
                continue
            nid = norm_id(self.facts.get((n, "national_id"), {}).get("canonical") or x.get("national_id"))
            dob = to_date(self.facts.get((n, "date_of_birth"), {}).get("canonical"))
            gender = self.facts.get((n, "gender"), {}).get("canonical")
            if not nid:
                continue
            problems = []
            if not re.fullmatch(r"\d{12}", nid):
                problems.append("không đủ 12 chữ số")
            else:
                if nid[:3] not in self.cfg.province_codes:
                    problems.append(f"mã tỉnh {nid[:3]} không có trong danh mục")
                g = int(nid[3])
                if dob:
                    century_ok = (g in (0, 1) and 1900 <= dob.year < 2000) or (g in (2, 3) and 2000 <= dob.year < 2100)
                    if not century_ok:
                        problems.append(f"chữ số thế kỷ {g} không khớp năm sinh {dob.year}")
                    if nid[4:6] != f"{dob.year % 100:02d}":
                        problems.append(f"năm sinh trong số ({nid[4:6]}) ≠ {dob.year}")
                if gender and ((g % 2 == 0) != (gender == "MALE")):
                    problems.append(f"chữ số giới tính {g} không khớp {gender}")
                # nơi đăng ký khai sinh trên thẻ
                for mt in self.cg.mentions:
                    doc = self.cg.docs[mt["doc"]]
                    if mt["party"] == n and doc["type"] == "id_card":
                        pob = ((doc["data"].get("card_info") or {}).get("place_of_birth_registration") or "")
                        code = self.cfg.province_by_name.get(norm_text(pob.split(",")[-1]))
                        if code and code != nid[:3]:
                            problems.append(f"mã tỉnh {nid[:3]} ≠ nơi đăng ký khai sinh {pob} ({code})")
            if problems:
                self.add("R-ID-FORMAT", "A|B", "A1", "K1", [self.fid(n, "national_id")],
                         f"{n}: số định danh {nid} không hợp cấu trúc", "; ".join(problems))
            prev = self.facts.get((n, "previous_id_numbers"))
            if prev and prev.get("canonical") and not re.fullmatch(r"\d{9}|\d{12}", norm_id(prev["canonical"])):
                self.add("R-ID-FORMAT", "A|B", "A1", "K1", [prev["id"]],
                         f"{n}: số CMND cũ {prev['canonical']} không phải 9 hoặc 12 chữ số")

    def rule_id_expiry(self):
        for mt in self.cg.mentions:
            doc = self.cg.docs[mt["doc"]]
            if doc["type"] != "id_card":
                continue
            li = doc["data"].get("legal_info") or {}
            issue, until = to_date(li.get("issue_date")), to_date(li.get("valid_until"))
            dob = to_date(self.facts.get((mt["party"], "date_of_birth"), {}).get("canonical"))
            if until and until < self.ref:
                self.add("R-ID-EXPIRY", "B", "B5", "K1", [self.fid(mt["party"], "national_id")],
                         f"{mt['party']}: thẻ {mt['doc']} hết hạn {until}", sev="S1")
            if issue and until and dob:
                age = issue.year - dob.year - ((issue.month, issue.day) < (dob.month, dob.day))
                nxt = [m for m in (25, 40, 60) if m > age]
                if nxt and nxt[0] - age <= 2:
                    nxt = nxt[1:]
                if nxt:
                    exp = date(dob.year + nxt[0], dob.month, dob.day)
                    if exp != until:
                        self.add("R-ID-EXPIRY", "A|B", "A2", "K3", [self.fid(mt["party"], "national_id")],
                                 f"{mt['party']}: hạn thẻ {until} khác mốc theo tuổi {exp}",
                                 f"cấp lúc {age} tuổi, mốc đổi thẻ kế tiếp {nxt[0]} tuổi")

    def rule_formats(self):
        for (ent, attr), f in self.facts.items():
            v = f.get("canonical")
            if v is None or isinstance(v, OneOf):
                continue
            s = norm_id(v) if isinstance(v, str) else ""
            bad = None
            if attr == "phone_number" and not re.fullmatch(r"0[35789]\d{8}", s):
                bad = "không phải số di động VN 10 chữ số"
            elif attr == "identifiers.certificate_number" and not re.fullmatch(r"[A-Z]{2}\d{6,8}", s):
                bad = "không đúng mẫu 2 chữ cái + 6–8 chữ số"
            elif attr == "registration_number" and not re.fullmatch(r"\d{10}(\d{3})?", s):
                bad = "không phải 10 hoặc 13 chữ số"
            if bad:
                self.add("R-FORMAT", "A|B", "A1", crit(attr, self.cfg), [f["id"]], f"{ent}.{attr} «{v}» {bad}")

    def rule_arithmetic(self):
        for gid in self.cg.plans:
            x = self.G.nodes[gid]
            for it in x["items"]:
                q, p, a = it.get("quantity"), it.get("unit_price"), it.get("amount")
                if all(isinstance(z, (int, float)) for z in (q, p, a)) and q * p != a:
                    self.add("R-ARITH", "A|B", "B3", "K2", [f"{gid}.items[{it.get('item_no')}]"],
                             f"{gid} dòng {it.get('item_no')}: {fmt(q)} × {fmt(p)} = {fmt(q * p)} ≠ {fmt(a)}")
            s = sum(it.get("amount") or 0 for it in x["items"])
            if x["total"] is not None and s != x["total"]:
                self.add("R-ARITH", "A|B", "B3", "K2", [self.fid(gid, "funding_plan.total")],
                         f"{gid}: tổng các dòng {fmt(s)} ≠ tổng ghi {fmt(x['total'])}")
            for lid in self.cg.loans:
                req = self.G.nodes[lid]["attrs"].get("loan_info.requested_amount")
                if self.G.has_edge(lid, gid) and req and x["total"] and req != x["total"]:
                    self.add("R-CROSS-DOC", "C", "C3", "K2",
                             [self.fid(lid, "loan_info.requested_amount"), self.fid(gid, "funding_plan.total")],
                             f"Tổng phương án vốn {fmt(x['total'])} ≠ số tiền vay {fmt(req)}")
        for b in self.cg.businesses:
            g = lambda a: (self.facts.get((b, a)) or {}).get("canonical")  # noqa: E731
            rev, cogs, gp, cost, net = (g(a) for a in ("net_revenue_annual", "cogs_annual", "gross_profit_annual",
                                                       "total_cost_annual", "net_profit_annual"))
            if None not in (rev, cogs, gp) and rev - cogs != gp:
                self.add("R-ARITH", "A|B", "B3", "K2", [self.fid(b, "gross_profit_annual")],
                         f"{b}: doanh thu − giá vốn = {fmt(rev - cogs)} ≠ lãi gộp {fmt(gp)}")
            if None not in (gp, cost, net) and gp - cost != net:
                self.add("R-ARITH", "A|B", "B3", "K2", [self.fid(b, "net_profit_annual")],
                         f"{b}: lãi gộp − chi phí = {fmt(gp - cost)} ≠ lợi nhuận {fmt(net)}")

    def rule_dates(self):
        for code, doc in self.cg.docs.items():
            for p, v in flatten(doc["data"]):
                if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", v):
                    d = to_date(v)
                    if d is None:
                        self.add("R-DATE", "A|B", "A2", "K3", [f"{code}.{p}"], f"{code}.{p} «{v}» không phải ngày hợp lệ")
                    elif d > self.ref and "valid_until" not in p and "queried_institutions" not in p:
                        self.add("R-DATE", "A|B", "A2", "K3", [f"{code}.{p}"],
                                 f"{code}.{p} = {v} sau ngày tham chiếu {self.ref}")

    def rule_forms(self):
        """Chứng từ tự khai phải có chữ ký người vay và ngày; tên người ký khớp người vay."""
        bname = self.G.nodes[self.borrower]["name"] if self.borrower else None
        for code, doc in self.cg.docs.items():
            if doc["type"] not in self.cfg.self_declared:
                continue
            li = doc["data"].get("legal_info") or {}
            sigs = [s for s in li.get("signatories") or [] if s]
            cust = [s for s in sigs if not s.get("organization")]
            dated = bool(to_date(li.get("issue_date")) or any(to_date(s.get("sign_date")) for s in sigs))
            missing = []
            if not cust:
                missing.append("chữ ký khách hàng")
            if not dated:
                missing.append("ngày lập/ký")
            if missing:
                self.add("R-FORM", "A|B", "B2", "K1", [f"{code}.signature"],
                         f"{code} {doc['type']}: không thấy {', '.join(missing)}",
                         "có thể chứng từ thiếu thật (B2) hoặc bản trích xuất bỏ sót (A5)", sev="S1",
                         note="thiếu chữ ký bên vay là mức chặn; hạ mức nếu ảnh có chữ ký")
            for s in cust:
                self._name_check(code, s.get("full_name"), bname, "người ký")
        for u, v, e in self.G.edges(data=True):
            if e["rel"] == "OWNS" and e.get("owner_names_raw"):
                self._name_check(e["src"][0], strip_honorific(e["owner_names_raw"]), self.G.nodes[u].get("name"),
                                 "chủ sở hữu khai trong đơn")

    def _name_check(self, code, got, want, label):
        if not got or not want:
            return
        a, b = got.strip().upper(), want.strip().upper()
        if a == b:
            return
        if norm_text(a) == norm_text(b):
            if strip_accents(a) == a or strip_accents(b) == b:
                return  # một bên viết không dấu: N
            self.add("R-NAME", "A|B", "B1", "K1", [f"{code}.name"], f"{code}: {label} «{got}» khác dấu với «{want}»")
        else:
            self.add("R-NAME", "C", "C1", "K1", [f"{code}.name"], f"{code}: {label} «{got}» khác người vay «{want}»")

    def rule_sources(self):
        # tài sản: giá trị không có chứng từ nguồn
        for (ent, attr), f in self.facts.items():
            if f["status"] == "không có nguồn chứng từ" and attr != "name":
                self.add("R-SOURCE", "B", "B6", crit(attr, self.cfg), [f["id"]],
                         f"{ent}.{attr} = {fmt(f['canonical'])} không có chứng từ nguồn",
                         f["obs"][0].get("note") or "", canonical=fmt(f["canonical"]))
        # người tham gia khoản vay nhưng không có giấy tờ nhân thân bậc 1
        has_t1 = defaultdict(bool)
        involved = defaultdict(set)
        for mt in self.cg.mentions:
            t = self.cg.docs[mt["doc"]]["type"]
            if t in ("id_card", "vneid", "qr_code_info"):
                has_t1[mt["party"]] = True
            if t in self.cfg.loan_docs and mt["role"] in self.cfg.role_canon:
                involved[mt["party"]].add(self.cfg.role_canon[mt["role"]])
        for p, rs in involved.items():
            if not has_t1[p]:
                self.add("R-SOURCE", "B", "B6", "K2", [f"{p}.identity_documents"],
                         f"{p} có vai trò {', '.join(sorted(rs))} nhưng hồ sơ không có CCCD/Căn cước/VNeID",
                         "thông tin nhân thân chỉ đến từ chứng từ bậc 2–3",
                         note="nâng S1 nếu xác định là người đồng vay")
        # mục checklist bắt buộc không có chứng từ
        for key, req in self.cg.items_without_record:
            if req:
                self.add("R-REQUIRED", "B", "B6", "K1", [f"checklist.{key}"],
                         f"Thiếu chứng từ bắt buộc: {key}", sev="S1")

    # ---------------------------------------------------------------- chạy
    def run(self):
        self.collect()
        # id_issue_date trước để làm mốc cho các thuộc tính giấy tờ khác
        order = sorted(self.facts.values(), key=lambda f: 0 if f["attr"] == "id_issue_date" else 1)
        for f in order:
            self.choose(f)
        for i, f in enumerate(self.facts.values(), 1):
            f["id"] = f"F{i}"
        for f in self.facts.values():
            self.cross_source(f)
        self.rule_income()
        self.rule_roles()
        self.rule_cic()
        self.rule_id_structure()
        self.rule_id_expiry()
        self.rule_formats()
        self.rule_arithmetic()
        self.rule_dates()
        self.rule_forms()
        self.rule_sources()
        self.disc.sort(key=lambda x: (self.cfg.severity_order.index(x["severity"]), x["class"] == "N", x["fields"]))
        for i, x in enumerate(self.disc, 1):
            x["id"] = f"X{i:02d}"
        by_field = {f["id"]: f for f in self.facts.values()}
        for x in self.disc:
            for fid in x["fields"]:
                if fid in by_field and x["class"] != "N":
                    by_field[fid]["flags"].append(f"{x['id']}:{x['class']}")
        return self

    # ---------------------------------------------------------------- xuất
    def facts_json(self):
        out = []
        for f in self.facts.values():
            out.append({"id": f["id"], "entity": f["entity"], "field": f["attr"], "group": f["group"],
                        "value": jsonable(f["canonical"]), "status": f["status"], "rule": f["rule"],
                        "sources": f["sources"], "criticality": crit(f["attr"], self.cfg), "flags": f["flags"],
                        "observations": [{"value": jsonable(o["v"]), "doc": o["doc"], "tier": o["tier"],
                                          "historical": o.get("hist", False), **({"note": o["note"]} if o["note"] else {})}
                                         for o in f["obs"]]})
        return out

    def disc_md(self):
        c = self.G.nodes["CASE"]
        n_items = [x for x in self.disc if x["class"] == "N"]
        rest = [x for x in self.disc if x["class"] != "N"]
        cnt = lambda key: ", ".join(f"{k} {v}" for k, v in sorted(  # noqa: E731
            defaultdict(int, {k: sum(1 for x in rest if x[key] == k) for k in {x[key] for x in rest}}).items(),
            key=lambda kv: (self.cfg.severity_order.index(kv[0]) if kv[0] in self.cfg.severity_order else kv[0])))
        L = [f"# Điểm lệch hồ sơ {c['case_id']}",
             f"Ngày tham chiếu {self.ref} · chỉ dựa trên JSON, chưa đọc ảnh · {len(rest)} điểm cần xử lý "
             f"({cnt('severity')}) · theo loại: {cnt('class')} · {len(n_items)} biến thể không phải lỗi (N)",
             "",
             "| X | Mức | Loại | Field | Nội dung | Giá trị chuẩn | Trạng thái | Nhánh 2 |",
             "|---|---|---|---|---|---|---|---|"]
        for x in rest:
            content = x["title"] + (f" — {x['detail']}" if x["detail"] else "") + (f" ({x['note']})" if x["note"] else "")
            L.append(f"| {x['id']} | {x['severity']} | {x['class']} {x['subclass']} | {', '.join(x['fields'])} | "
                     f"{content} | {x['canonical'] or ''} | {x['status']} | {'có' if x['to_branch2'] else ''} |")
        L += ["", "## Biến thể không phải lỗi (N, tự đóng)", ""]
        for x in n_items:
            L.append(f"- {x['id']} {', '.join(x['fields'])}: {x['title']} — {x['detail']}")
        return "\n".join(L) + "\n"

    def branch2_context(self):
        G, c = self.G, self.G.nodes["CASE"]
        facts_by_ent = defaultdict(list)
        for f in self.facts.values():
            facts_by_ent[f["entity"]].append(f)
        cflags = {x["id"]: x for x in self.disc if x["class"] == "C"}
        L = [f"# HỒ SƠ {c['case_id']} · {c['segment']} · {c['product_name']} — ngữ cảnh thẩm định",
             "Quy ước: chỉ có giá trị chuẩn (đã chọn theo thẩm quyền, hiệu lực thời gian, đa số nguồn độc lập). "
             "Lỗi đọc và lỗi lập hồ sơ do nhánh kiểm soát dữ liệu xử lý, KHÔNG đánh giá ở đây. "
             "Mục «Mâu thuẫn nội dung» là tín hiệu thẩm định. Mỗi kết luận phải trích F# (field) hoặc X# (mâu thuẫn).",
             ""]

        def fline(f):
            v = "chưa xác định" if f["status"] == "chưa xác định" else fmt(f["canonical"])
            src = f"[{','.join(f['sources'])}]" if f["sources"] else ""
            extra = []
            if f["status"] == "không có nguồn chứng từ":
                extra.append("không có chứng từ nguồn")
            extra += [fl.split(":")[0] for fl in f["flags"] if fl.endswith(":C")]
            return f"  {f['id']} {f['attr']}: {v} {src}" + (f" ⚠ {', '.join(extra)}" if extra else "")

        L.append("## Chứng từ")
        for code, doc in self.cg.docs.items():
            li = doc["data"].get("legal_info") or {}
            d = self.doc_dates.get(code)
            L.append(f"{code} {doc['type']}" + (f" «{li['document_title']}»" if li.get("document_title") else "")
                     + (f" {d}" if d else ""))
        L.append("")
        L.append("## Người")
        for n, x in G.nodes(data=True):
            if x.get("kind") != "party":
                continue
            roles = []
            for r, _, d in x["roles"]:
                if r not in roles:
                    roles.append(r)
            L.append(f"{n} {x.get('name')} · vai trò trong chứng từ: {', '.join(roles)}")
            L += [fline(f) for f in facts_by_ent[n] if f["attr"] != "name"]
        L.append("")
        # quan hệ: lấy từ graph
        L.append("## Quan hệ")
        seen = OrderedDict()
        for u, v, e in G.edges(data=True):
            if e["rel"] in ("MENTIONS", "HAS_DOCUMENT", "CIC_QUERIED_BY", "EVIDENCES"):
                continue
            m = seen.setdefault((u, e["rel"], v), {"src": [], "extra": []})
            m["src"] += [s for s in e.get("src", []) if s not in m["src"]]
            for k in ("role", "ownership_form", "registration_date"):
                if e.get(k) and f"{k}={e[k]}" not in m["extra"]:
                    m["extra"].append(f"{k}={e[k]}")
        for (u, r, v), m in seen.items():
            L.append(f"{u} -{r}-> {v} [{','.join(m['src'])}]" + (f" {'; '.join(m['extra'])}" if m["extra"] else ""))
        L.append("")
        for lid in self.cg.loans:
            L.append(f"## Khoản vay đề nghị {lid}")
            L += [fline(f) for f in facts_by_ent[lid]]
            L.append("")
        for b in self.cg.businesses:
            L.append(f"## Hộ kinh doanh {b}")
            L += [fline(f) for f in facts_by_ent[b]]
            L.append("")
        for gid in self.cg.plans:
            x = G.nodes[gid]
            L.append(f"## Phương án sử dụng vốn {gid} [{x['src']}]")
            L += [fline(f) for f in facts_by_ent[gid]]
            L.append("  # | mặt hàng | ĐVT | SL | đơn giá | thành tiền")
            for it in x["items"]:
                L.append(f"  {it.get('item_no')} | {it.get('item_name')} | {it.get('unit')} | {fmt(it.get('quantity'))} | "
                         f"{fmt(it.get('unit_price'))} | {fmt(it.get('amount'))}")
            L.append("")
        for n, x in G.nodes(data=True):
            if x.get("kind") == "asset":
                L.append(f"## Tài sản {n}")
                L += [fline(f) for f in facts_by_ent[n]]
                L.append("")
        for code, subj, rep in self.cg.cic:
            L.append(f"## Báo cáo CIC [{code}] · chủ thể {subj}")
            L += [fline(f) for f in facts_by_ent[f"CIC@{code}"]]
            d = self.doc_dates.get(code)
            for u, v, e in G.out_edges(subj, data=True):
                if e["rel"] == "CIC_QUERIED_BY" and code in e["src"]:
                    ok = sorted(q for q in e["dates"] if to_date(q) and (not d or to_date(q) <= d))
                    L.append(f"  tra cứu bởi {G.nodes[v]['name']}: {', '.join(ok)}"
                             + (f" (+{len(e['dates']) - len(ok)} lượt ngày không hợp lệ, không tính)"
                                if len(ok) < len(e["dates"]) else ""))
            L.append("")
        L.append("## Mâu thuẫn nội dung (C) — tín hiệu thẩm định")
        for xid, x in cflags.items():
            L.append(f"{xid} [{', '.join(x['fields'])}] {x['title']} — {x['detail']}"
                     + (f" · giá trị chuẩn: {x['canonical']}" if x["canonical"] else "")
                     + (f" · {x['note']}" if x["note"] else ""))
        L.append("")
        L.append("## Giới hạn dữ liệu (không đánh giá lỗi, chỉ để biết dữ liệu nào không có)")
        if self.borrower and any(subj != self.borrower for _, subj, _ in self.cg.cic):
            L.append(f"- Người vay {self.borrower} chưa có báo cáo CIC trong hồ sơ.")
        for f in self.facts.values():
            if f["status"] == "chưa xác định":
                L.append(f"- {f['id']} {f['entity']}.{f['attr']}: chưa xác định giá trị hiện tại.")
            elif f["status"] == "không có nguồn chứng từ" and f["attr"] != "name":
                L.append(f"- {f['id']} {f['entity']}.{f['attr']}: có giá trị nhưng không có chứng từ nguồn.")
        for x in self.disc:
            if x["rule"] == "R-SOURCE" and x["fields"][0].endswith("identity_documents"):
                L.append(f"- {x['title']}.")
        return "\n".join(L).rstrip() + "\n"


def _doc_sort(s):
    m = re.fullmatch(r"D(\d+)", s)
    return (0, int(m.group(1))) if m else (1, s)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("."))
    ap.add_argument("--ref-date", type=date.fromisoformat, default=None,
                    help="ngày tham chiếu (mặc định: case.completed_at)")
    ap.add_argument("--cic-max-age", type=int, default=None, help="số ngày hiệu lực CIC (mặc định theo cấu hình)")
    ap.add_argument("--config", default=None, help="sản phẩm@version, vd pp-hkd-secured@0.1.0")
    a = ap.parse_args()
    cfg = load_config(*a.config.split("@")) if a.config else load_config()
    v = Validator(load(a.input), a.ref_date, a.cic_max_age, cfg).run()
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "facts.json").write_text(json.dumps(v.facts_json(), ensure_ascii=False, indent=1), encoding="utf-8")
    (a.out / "discrepancies.json").write_text(json.dumps(jsonable(v.disc), ensure_ascii=False, indent=1),
                                              encoding="utf-8")
    (a.out / "discrepancies.md").write_text(v.disc_md(), encoding="utf-8")
    ctx = v.branch2_context()
    (a.out / "branch2_context.md").write_text(ctx, encoding="utf-8")
    rest = [x for x in v.disc if x["class"] != "N"]
    print(f"facts={len(v.facts)} · điểm lệch={len(rest)} (+{len(v.disc) - len(rest)} N) · "
          f"S1={sum(x['severity'] == 'S1' for x in rest)} S2={sum(x['severity'] == 'S2' for x in rest)} "
          f"S3={sum(x['severity'] == 'S3' for x in rest)} · sang nhánh 2 (C)={sum(x['to_branch2'] for x in rest)}")
    print(f"branch2_context.md ≈ {approx_tokens(ctx):,} token")


if __name__ == "__main__":
    main()
