#!/usr/bin/env python3
"""
Dựng graph quan hệ thực thể cho một bộ hồ sơ vay (schema dugate.loan-appraisal.integration 5.0)
và xuất llm_context gọn cho AI thẩm định.

Nguyên tắc:
  - CHỈ dùng thông tin hồ sơ: documents.records (dữ liệu trích từ chứng từ) + danh tính tối thiểu
    của parties/assets (tên, số định danh). Bỏ hoàn toàn: findings, checks, checks_summary,
    decision, financials, notes, trạng thái checklist (status/code/action) của documents.items.
  - Mọi fact đều mang provenance [D#] = chứng từ nguồn.
  - Các bản ghi trùng hệt nhau (một chứng từ dùng cho nhiều mục checklist) gộp thành 1 node chứng từ.
  - Mỗi "parties[i]" trong từng chứng từ là một mention; script tự liên kết mention -> người
    bằng bằng chứng trong chứng từ (ngày sinh, giới tính, số định danh cũ, SĐT, ngày cấp, địa chỉ)
    và ghi rõ bằng chứng liên kết, không dựa vào việc pipeline gán cả bản ghi cho một party.

Dùng:
  python -m lac.graph case.json -o out/            # graph.json + llm_context.md
  python -m lac.graph case.json -o out/ --derived  # thêm khối số học thuần (tổng, tỷ lệ)
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import OrderedDict, defaultdict
from pathlib import Path

import networkx as nx

# ----------------------------------------------------------------------------- helpers

EXCLUDED_TOP_LEVEL = {"findings", "checks", "checks_summary", "decision", "financials", "notes"}
PATH_TOKEN = re.compile(r"([^.\[\]]+)|\[(\d+)\]")
ADMIN_PREFIX = re.compile(
    r"^(thanh pho|thi tran|thi xa|tp\.?|tinh|huyen|quan|xa|phuong)\s+", re.I)


def strip_accents(s: str) -> str:
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm_text(s) -> str:
    if s is None:
        return ""
    s = strip_accents(str(s)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def norm_id(s) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(s or "")).upper()


def norm_admin(s) -> str:
    t = norm_text(s)
    while True:
        t2 = ADMIN_PREFIX.sub("", t)
        if t2 == t:
            return t
        t = t2


def is_address(v) -> bool:
    return isinstance(v, dict) and "full_text" in v


def addr_key(a: dict) -> tuple:
    """Khoá so sánh địa chỉ: (đường/thôn, phường/xã, tỉnh). Bỏ cấp huyện vì sáp nhập 2025
    làm cùng một địa chỉ có bản ghi có huyện, bản ghi không."""
    return (norm_text(a.get("street")), norm_admin(a.get("ward")), norm_admin(a.get("province")))


def addr_match(a: dict, b: dict) -> str | None:
    ka, kb = addr_key(a), addr_key(b)
    if not ka[0] or ka[0] != kb[0]:
        return None
    rest = [(x, y) for x, y in zip(ka[1:], kb[1:]) if x and y]
    if any(x != y for x, y in rest):
        return None
    return "full" if len(rest) == 2 else "street"


class OneOf(list):
    """Giá trị CONFLICT trong một chứng từ: trích xuất ra nhiều ứng viên."""


def unflatten(fields: list[dict]) -> dict:
    root: dict = {}
    for f in fields:
        val = f.get("value")
        if f.get("status") == "CONFLICT" and val is None and f.get("candidates"):
            val = OneOf(f["candidates"])
        toks = [m.group(1) if m.group(1) is not None else int(m.group(2))
                for m in PATH_TOKEN.finditer(f["path"])]
        cur = root
        for i, k in enumerate(toks):
            if i == len(toks) - 1:
                cur[k] = val
            else:
                cur = cur.setdefault(k, {})
    return _listify(root)


def _listify(o):
    if isinstance(o, OneOf):
        return o
    if isinstance(o, dict):
        o = {k: _listify(v) for k, v in o.items()}
        if o and all(isinstance(k, int) for k in o):
            out = [None] * (max(o) + 1)
            for k, v in o.items():
                out[k] = v
            return out
        return o
    return o


def flatten(o, prefix=""):
    """dict lồng -> [(path, value)] (địa chỉ và OneOf giữ nguyên là lá)."""
    if is_address(o) or isinstance(o, OneOf) or not isinstance(o, (dict, list)):
        yield prefix, o
        return
    items = o.items() if isinstance(o, dict) else enumerate(o)
    for k, v in items:
        if v is None:
            continue
        p = f"{prefix}[{k}]" if isinstance(k, int) else (f"{prefix}.{k}" if prefix else k)
        yield from flatten(v, p)


def fmt(v) -> str:
    if isinstance(v, OneOf):
        return "⟨" + " | ".join(fmt(x) for x in v) + "⟩"
    if is_address(v):
        return v.get("full_text") or ""
    if isinstance(v, bool):
        return "có" if v else "không"
    if isinstance(v, int):
        return f"{v:,}".replace(",", ".")
    if isinstance(v, float):
        return f"{v:g}"
    if isinstance(v, list):
        return ", ".join(fmt(x) for x in v)
    return str(v)


def value_key(attr: str, v) -> str:
    if isinstance(v, OneOf):
        return "oneof:" + "|".join(sorted(norm_text(fmt(x)) for x in v))
    if is_address(v):
        return "addr:" + "|".join(addr_key(v))
    if "number" in attr or attr.endswith("_id"):
        return norm_id(v)
    return norm_text(fmt(v))


def jsonable(o):
    if isinstance(o, OneOf):
        return {"one_of": [jsonable(x) for x in o]}
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [jsonable(x) for x in o]
    return o


def approx_tokens(s: str) -> int:
    # Ước tính thô cho tiếng Việt + JSON (~3 ký tự/token). Đo bằng tokenizer thật khi tích hợp.
    return round(len(s) / 3)


# ----------------------------------------------------------------------------- graph builder

class CaseGraph:
    def __init__(self, data: dict, config=None):
        if config is None:
            from lac.config import load_config  # import muộn: config.py dùng helper của module này
            config = load_config()
        self.cfg = config
        self.d = data
        self.G = nx.MultiDiGraph()
        self.docs: "OrderedDict[str, dict]" = OrderedDict()   # code -> {type, items, data}
        self.mentions: list[dict] = []                         # parties[i] của từng chứng từ
        self.party_ids: dict[str, str] = {}                    # case party id -> P#
        self.asset_ids: dict[str, str] = {}                    # case asset id -> A#
        self.unresolved = 0

    # ---- 1. nodes gốc
    def build(self):
        self._case_node()
        self._docs()
        self._parties_seed()
        self._assets_seed()
        self._collect_mentions()
        self._resolve_mentions()
        self._party_observations()
        self._relations()
        self._loan_business_plan()
        self._assets_from_docs()
        self._cic()
        return self.G

    def _case_node(self):
        c = self.d.get("case", {})
        p = c.get("profile", {})
        self.G.add_node("CASE", kind="case", case_id=c.get("id"), segment=p.get("segment"),
                        product=p.get("product"), product_name=p.get("product_name"),
                        flow=p.get("flow"))

    def _docs(self):
        recs = self.d.get("documents", {}).get("records", [])
        required = {i["key"]: i.get("required") for i in self.d.get("documents", {}).get("items", [])}
        seen: dict[str, str] = {}
        for r in recs:
            sig = r["doc"] + json.dumps(r["fields"], ensure_ascii=False, sort_keys=True)
            if sig in seen:
                code = seen[sig]
                self.docs[code]["items"].append((r["item"], required.get(r["item"])))
                continue
            code = f"D{len(self.docs) + 1}"
            seen[sig] = code
            self.docs[code] = {"type": r["doc"], "items": [(r["item"], required.get(r["item"]))],
                               "data": unflatten(r["fields"]), "asset_hint": r.get("asset"),
                               "party_hint": r.get("party")}
        for code, doc in self.docs.items():
            li = doc["data"].get("legal_info", {}) or {}
            self.G.add_node(code, kind="document", doc_type=doc["type"],
                            title=li.get("document_title"), number=li.get("document_number"),
                            issuer=li.get("issuing_authority"), issue_date=li.get("issue_date"),
                            issue_place=li.get("issue_place"), items=[i for i, _ in doc["items"]])
            self.G.add_edge("CASE", code, rel="HAS_DOCUMENT")
        # mục checklist không có bản ghi nào
        have = {i for d in self.docs.values() for i, _ in d["items"]}
        self.items_without_record = [(i["key"], i.get("required"))
                                     for i in self.d.get("documents", {}).get("items", [])
                                     if i["key"] not in have]

    def _parties_seed(self):
        self.profiles: dict[str, dict] = {}
        for n, p in enumerate(self.d.get("parties", []), 1):
            pid = f"P{n}"
            self.party_ids[p["id"]] = pid
            ids = {i["type"]: i["value"] for i in p.get("identifiers", [])}
            f = {x["path"]: x.get("value") for x in p.get("fields", []) if x.get("status") != "CONFLICT"}
            self.G.add_node(pid, kind="party", entity_type=p.get("type"), name=p.get("name"),
                            national_id=ids.get("NATIONAL_ID"), obs=defaultdict(list), roles=[])
            # hồ sơ nhận dạng dùng để liên kết mention (chỉ định danh cứng)
            self.profiles[pid] = {
                "dob": {f["date_of_birth"]} if f.get("date_of_birth") else set(),
                "gender": {f["gender"]} if f.get("gender") else set(),
                "national_id": {norm_id(ids["NATIONAL_ID"])} if ids.get("NATIONAL_ID") else set(),
                "prev_id": set(), "phone": set(), "id_issue_date": set(), "addresses": [],
                "name": norm_text(p.get("name")),
            }

    def _assets_seed(self):
        for n, a in enumerate(self.d.get("assets", []), 1):
            aid = f"A{n}"
            self.asset_ids[a["id"]] = aid
            ids = {i["type"]: i["value"] for i in a.get("identifiers", [])}
            f = {x["path"]: x.get("value") for x in a.get("fields", [])}
            self.G.add_node(aid, kind="asset", asset_type=a.get("type"),
                            certificate_number=ids.get("CERTIFICATE_NUMBER"),
                            obs=defaultdict(list),
                            # giá trị TSBĐ không có trong bản ghi chứng từ nào -> ghi rõ nguồn
                            case_value=f.get("asset_value"))

    # ---- 2. mention & liên kết danh tính
    def _collect_mentions(self):
        for code, doc in self.docs.items():
            for idx, m in enumerate(doc["data"].get("parties") or []):
                if not m:
                    continue
                details = (doc["data"].get("party_details") or [None] * (idx + 1))
                det = details[idx] if idx < len(details) else None
                self.mentions.append({"doc": code, "idx": idx, "data": m, "details": det or {},
                                      "role": m.get("party_role"), "role_raw": m.get("party_role_raw"),
                                      "party": None, "evidence": [], "against": [], "score": None})

    def _mention_ids(self, mt):
        m, doc = mt["data"], self.docs[mt["doc"]]
        prev = set(norm_id(x) for x in (m.get("previous_id_numbers") or []) if x)
        nat = set()
        if doc["type"] == "id_card" and mt["idx"] == 0:
            num = (doc["data"].get("legal_info") or {}).get("document_number")
            if num:
                nat.add(norm_id(num))
        return prev, nat

    def _score(self, mt, pid):
        w = self.cfg.identity.w
        m, pr = mt["data"], self.profiles[pid]
        s, ev, neg = 0, [], []
        prev, nat = self._mention_ids(mt)
        if nat:
            if nat & pr["national_id"]:
                s += w("national_id"); ev.append("số CCCD")
            elif pr["national_id"]:
                s += w("national_id", "mismatch"); neg.append("số CCCD khác")
        if m.get("date_of_birth") and pr["dob"]:
            if m["date_of_birth"] in pr["dob"]:
                s += w("date_of_birth"); ev.append("ngày sinh")
            else:
                s += w("date_of_birth", "mismatch"); neg.append("ngày sinh khác")
        if m.get("gender") and pr["gender"]:
            if m["gender"] in pr["gender"]:
                s += w("gender"); ev.append("giới tính")
            else:
                s += w("gender", "mismatch"); neg.append("giới tính khác")
        if prev:
            if prev & pr["prev_id"] or prev & pr["national_id"]:
                s += w("previous_id"); ev.append("số CMND cũ")
            elif pr["prev_id"]:
                s += w("previous_id", "mismatch"); neg.append(f"CMND cũ {'/'.join(sorted(prev))} ≠ {'/'.join(sorted(pr['prev_id']))}")
        if m.get("phone_number") and m["phone_number"] in pr["phone"]:
            s += w("phone"); ev.append("SĐT")
        if m.get("id_issue_date") and m["id_issue_date"] in pr["id_issue_date"]:
            s += w("id_issue_date"); ev.append("ngày cấp giấy tờ")
        for key in ("permanent_address", "current_address"):
            a = m.get(key)
            if is_address(a):
                hit = next((addr_match(a, b) for b in pr["addresses"] if addr_match(a, b)), None)
                if hit:
                    s += w("address"); ev.append(f"địa chỉ ({'đầy đủ' if hit == 'full' else 'khớp số nhà/đường'})")
                    break
        return s, ev, neg

    def _absorb(self, mt, pid):
        m, pr = mt["data"], self.profiles[pid]
        prev, nat = self._mention_ids(mt)
        pr["prev_id"] |= prev
        pr["national_id"] |= nat
        for k, dst in (("date_of_birth", "dob"), ("gender", "gender"), ("phone_number", "phone"),
                       ("id_issue_date", "id_issue_date")):
            if m.get(k):
                pr[dst].add(m[k])
        for key in ("permanent_address", "current_address"):
            if is_address(m.get(key)):
                pr["addresses"].append(m[key])

    def _taken(self, doc):
        return {x["party"] for x in self.mentions if x["doc"] == doc and x["party"]}

    def _resolve_mentions(self):
        # vòng lặp: liên kết mention chắc nhất trước, tích luỹ bằng chứng, rồi lặp lại
        changed = True
        while changed:
            changed = False
            best_round = None
            for mt in self.mentions:
                if mt["party"]:
                    continue
                cands = [p for p in self.profiles if p not in self._taken(mt["doc"])]
                scored = sorted(((self._score(mt, p), p) for p in cands), key=lambda x: -x[0][0])
                if not scored:
                    continue
                (s1, ev, _), p1 = scored[0]
                s2 = scored[1][0][0] if len(scored) > 1 else 0
                idc = self.cfg.identity
                if s1 >= idc.min_score and s1 - s2 >= idc.min_margin and (best_round is None or s1 > best_round[0]):
                    best_round = (s1, mt, p1, ev, [(p, sc[2]) for sc, p in scored[1:] if sc[2]])
            if best_round:
                s1, mt, p1, ev, against = best_round
                mt.update(party=p1, score=s1, evidence=ev, against=against,
                          confidence="cao" if s1 >= self.cfg.identity.high_confidence else "trung bình")
                self._absorb(mt, p1)
                changed = True
        # chủ sở hữu trên GCN không có thuộc tính nhận dạng: nối qua chứng từ khác cùng số GCN
        cert_owner = {}
        for code, doc in self.docs.items():
            assets = doc["data"].get("assets") or []
            dets = doc["data"].get("asset_details") or []
            for i, a in enumerate(assets):
                cert = norm_id(((a or {}).get("identifiers") or {}).get("certificate_number"))
                det = dets[i] if i < len(dets) else None
                for oi in ((det or {}).get("owner_party_indexes") or []):
                    owner = next((x for x in self.mentions if x["doc"] == code and x["idx"] == oi), None)
                    if cert and owner and owner["party"]:
                        cert_owner[cert] = (owner["party"], code, (det or {}).get("owner_names_raw"))
        for mt in self.mentions:
            if mt["party"]:
                continue
            doc = self.docs[mt["doc"]]
            certs = [norm_id(((a or {}).get("identifiers") or {}).get("certificate_number"))
                     for a in (doc["data"].get("assets") or [])]
            hit = next((cert_owner[c] for c in certs if c in cert_owner), None)
            if hit and mt["role"] == "OWNER":
                pid, src, raw = hit
                mt.update(party=pid, confidence="trung bình",
                          evidence=[f"cùng số GCN, chủ sở hữu theo {src}" + (f" «{raw}»" if raw else "")])
                self._absorb(mt, pid)
        # còn lại: tạo node chưa xác định (không đoán)
        for mt in self.mentions:
            if not mt["party"]:
                self.unresolved += 1
                uid = f"U{self.unresolved}"
                self.G.add_node(uid, kind="party", entity_type="UNRESOLVED", name=None,
                                national_id=None, obs=defaultdict(list), roles=[])
                mt.update(party=uid, confidence="không xác định", evidence=[])
        for mt in self.mentions:
            self.G.add_edge(mt["doc"], mt["party"], rel="MENTIONS", idx=mt["idx"], role=mt["role"],
                            role_raw=mt["role_raw"], confidence=mt["confidence"],
                            evidence=mt["evidence"], against=jsonable(mt["against"]))
            self.G.nodes[mt["party"]]["roles"].append((mt["role"], mt["role_raw"], mt["doc"]))

    def _party_observations(self):
        skip = {"party_role", "party_role_raw", "party_type", "ownership"}
        for mt in self.mentions:
            obs = self.G.nodes[mt["party"]]["obs"]
            for path, v in flatten({k: v for k, v in mt["data"].items() if k not in skip}):
                attr = re.sub(r"\[\d+\]", "", path)
                obs[attr].append((v, mt["doc"]))
            for k in ("marital_status",):
                if mt["details"].get(k):
                    obs[k].append((mt["details"][k], mt["doc"]))
        # địa chỉ ngoài mention (VD: CIC ghi current_address ở parties[0]) đã nằm trong data

    # ---- 3. quan hệ giữa người
    def _relations(self):
        by_doc = defaultdict(dict)
        for mt in self.mentions:
            by_doc[mt["doc"]][mt["idx"]] = mt
        for code, doc in self.docs.items():
            ms = by_doc.get(code, {})
            roles = {mt["role"]: mt for mt in ms.values()}
            data = doc["data"]
            if "WIFE" in roles and "HUSBAND" in roles:
                self._spouse(roles["WIFE"]["party"], roles["HUSBAND"]["party"], code,
                             registration_date=data.get("registration_date"),
                             place=data.get("place_of_registration"))
            for idx, mt in ms.items():
                rel = mt["details"].get("relationship_to_borrower")
                if rel == "SPOUSE":
                    borrower = next((x for x in ms.values() if x["role"] in ("BORROWER", "CUSTOMER")), None)
                    if borrower:
                        self._spouse(borrower["party"], mt["party"], code)

    def _spouse(self, a, b, src, **kw):
        for u, v, k, e in self.G.edges(a, keys=True, data=True):
            if v == b and e["rel"] == "SPOUSE":
                e["src"].append(src)
                e.update({x: y for x, y in kw.items() if y})
                return
        self.G.add_edge(a, b, rel="SPOUSE", src=[src], **{x: y for x, y in kw.items() if y})

    # ---- 4. khoản vay, HKD, phương án vốn
    def _borrower_of(self, code):
        mt = next((x for x in self.mentions if x["doc"] == code
                   and x["role"] in ("BORROWER", "CUSTOMER", "HOLDER")), None)
        return mt["party"] if mt else None

    def _loan_business_plan(self):
        self.loans, self.businesses, self.plans = [], [], []
        biz_index = {}

        def business(name, src):
            key = norm_text(name)
            if key not in biz_index:
                bid = f"B{len(biz_index) + 1}"
                biz_index[key] = bid
                self.G.add_node(bid, kind="business", name=name, obs=defaultdict(list))
                self.businesses.append(bid)
            return biz_index[key]

        for code, doc in self.docs.items():
            data, t = doc["data"], doc["type"]
            borrower = self._borrower_of(code)
            if "loan_info" in data:
                lid = f"L{len(self.loans) + 1}"
                self.loans.append(lid)
                attrs = {}
                for sec in ("loan_info", "financial_info", "officer_info", "collateral_summary"):
                    for p, v in flatten(data.get(sec) or {}):
                        attrs[f"{sec}.{p}"] = v
                self.G.add_node(lid, kind="loan_request", src=code, attrs=attrs)
                if borrower:
                    self.G.add_edge(borrower, lid, rel="APPLIES_FOR", src=[code])
                for mt in self.mentions:
                    if mt["doc"] == code and mt["party"] != borrower:
                        self.G.add_edge(mt["party"], lid, rel="PARTICIPATES", role=mt["role"], src=[code])
                for a in data.get("assets") or []:
                    cert = norm_id(((a or {}).get("identifiers") or {}).get("certificate_number"))
                    aid = next((n for n, x in self.G.nodes(data=True)
                                if x.get("kind") == "asset" and norm_id(x.get("certificate_number")) == cert), None)
                    if aid:
                        self.G.add_edge(lid, aid, rel="SECURED_BY", src=[code],
                                        matched_by=f"số GCN {a['identifiers']['certificate_number']}",
                                        usage=a.get("usage_context_hint"))
                for i, det in enumerate(data.get("asset_details") or []):
                    a = (data.get("assets") or [None] * (i + 1))[i] or {}
                    cert = norm_id((a.get("identifiers") or {}).get("certificate_number"))
                    aid = next((n for n, x in self.G.nodes(data=True)
                                if x.get("kind") == "asset" and norm_id(x.get("certificate_number")) == cert), None)
                    for oi in (det or {}).get("owner_party_indexes") or []:
                        owner = next((x for x in self.mentions if x["doc"] == code and x["idx"] == oi), None)
                        if aid and owner:
                            self.G.add_edge(owner["party"], aid, rel="OWNS", src=[code],
                                            owner_names_raw=det.get("owner_names_raw"),
                                            collateral_type_raw=det.get("collateral_type_raw"))
            bi = data.get("business_info")
            if bi and bi.get("business_name"):
                bid = business(bi["business_name"], code)
                for p, v in flatten(bi):
                    self.G.nodes[bid]["obs"][p].append((v, code))
                if borrower:
                    self.G.add_edge(borrower, bid, rel="OWNS_BUSINESS", src=[code])
                if self.loans and self.G.nodes[self.loans[-1]]["src"] == code:
                    self.G.add_edge(self.loans[-1], bid, rel="FOR_BUSINESS", src=[code])
            for src_i in data.get("income_sources") or []:
                hb = (src_i or {}).get("household_business")
                if not hb:
                    continue
                bid = business(hb.get("business_name") or f"HKD ({code})", code)
                for p, v in flatten(hb):
                    self.G.nodes[bid]["obs"][p].append((v, code))
                self.G.nodes[bid]["obs"]["income_type"].append((src_i.get("income_type"), code))
                self.G.nodes[bid]["obs"]["source_label_raw"].append((src_i.get("source_label_raw"), code))
                if borrower:
                    self.G.add_edge(borrower, bid, rel="OWNS_BUSINESS", src=[code])
            if t == "purchase_list" or "funding_plan" in data:
                gid = f"G{len(self.plans) + 1}"
                self.plans.append(gid)
                self.G.add_node(gid, kind="funding_plan", src=code,
                                total=(data.get("funding_plan") or {}).get("total_amount"),
                                items=[x for x in (data.get("items") or []) if x])
                if borrower:
                    self.G.add_edge(borrower, gid, rel="SUBMITS", src=[code])
        # gắn phương án vốn vào khoản vay cùng người vay
        for gid in self.plans:
            owner = next((u for u, _, e in self.G.in_edges(gid, data=True) if e["rel"] == "SUBMITS"), None)
            for lid in self.loans:
                if owner and self.G.has_edge(owner, lid):
                    self.G.add_edge(lid, gid, rel="USE_OF_FUNDS", src=[self.G.nodes[gid]["src"]],
                                    matched_by="cùng người vay")

    def _assets_from_docs(self):
        for code, doc in self.docs.items():
            data = doc["data"]
            if doc["type"] == "loan_application":
                continue  # đơn vay đã xử lý ở trên
            for i, a in enumerate(data.get("assets") or []):
                cert = norm_id(((a or {}).get("identifiers") or {}).get("certificate_number"))
                aid = next((n for n, x in self.G.nodes(data=True)
                            if x.get("kind") == "asset" and norm_id(x.get("certificate_number")) == cert), None)
                if not aid:
                    continue
                obs = self.G.nodes[aid]["obs"]
                for p, v in flatten(a):
                    obs[p].append((v, code))
                det = (data.get("asset_details") or [None] * (i + 1))
                det = det[i] if i < len(det) else None
                for p, v in flatten(det or {}):
                    obs[p].append((v, code))
                self.G.add_edge(code, aid, rel="EVIDENCES", src=[code])
                for mt in self.mentions:
                    if mt["doc"] == code and mt["role"] == "OWNER":
                        own = mt["data"].get("ownership") or {}
                        self.G.add_edge(mt["party"], aid, rel="OWNS", src=[code],
                                        ownership_form=(det or {}).get("ownership_form"),
                                        is_current_owner=own.get("is_current_owner"),
                                        ownership_source=own.get("ownership_source"))

    def _cic(self):
        self.cic = []
        inst_index = {}
        for code, doc in self.docs.items():
            for rep in doc["data"].get("reports") or []:
                if not rep:
                    continue
                subj = self._borrower_of(code)
                self.cic.append((code, subj, rep))
                for q in rep.get("queried_institutions") or []:
                    if not q:
                        continue
                    key = norm_text(q.get("institution"))
                    if key not in inst_index:
                        iid = f"I{len(inst_index) + 1}"
                        inst_index[key] = iid
                        self.G.add_node(iid, kind="institution", name=q.get("institution"))
                    iid = inst_index[key]
                    e = self.G.get_edge_data(subj, iid)
                    if e:
                        next(iter(e.values()))["dates"].append(q.get("query_date"))
                    else:
                        self.G.add_edge(subj, iid, rel="CIC_QUERIED_BY", src=[code], dates=[q.get("query_date")])

    # ----------------------------------------------------------------------------- render

    def render(self, derived=False) -> str:
        G, out = self.G, []
        w = out.append
        c = G.nodes["CASE"]
        w(f"# HỒ SƠ {c['case_id']} · {c['segment']} · {c['product_name']} · luồng {c['flow']}")
        w("Ký hiệu: [D#] chứng từ nguồn · P# người · B# hộ kinh doanh · A# tài sản · L# khoản vay đề nghị · "
          "G# phương án vốn · ⟨a | b⟩ chứng từ đọc ra nhiều giá trị · ≈n: n cách viết cùng nghĩa "
          "(địa chỉ so theo thôn/đường + xã + tỉnh, bỏ cấp huyện).")
        w("Chỉ chứa dữ liệu trích từ chứng từ; không có kết luận/kiểm tra của hệ thống.\n")

        # chứng từ
        w("## Chứng từ")
        consumed = {"parties", "party_details", "legal_info", "loan_info", "business_info", "financial_info",
                    "assets", "asset_details", "collateral_summary", "officer_info", "items", "funding_plan",
                    "income_sources", "reports", "marital_status", "registration_date",
                    "place_of_registration"}
        for code, doc in self.docs.items():
            li = doc["data"].get("legal_info") or {}
            bits = [f"{code} {doc['type']}"]
            if li.get("document_title"):
                bits.append(f"«{li['document_title']}»")
            for k, label in (("document_number", "số"), ("form_template_number", "mẫu"),
                             ("issuing_authority", "cơ quan"), ("issue_date", "ngày"),
                             ("issue_place", "nơi"), ("valid_until", "hiệu lực đến")):
                if li.get(k) is not None:
                    bits.append(f"{label} {fmt(li[k])}")
            sig = [s for s in (li.get("signatories") or []) if s]
            if sig:
                ss = []
                for s in sig:
                    extra = ", ".join(fmt(s[k]) for k in ("position", "organization") if s.get(k))
                    t = s.get("full_name", "?") + (f" ({extra})" if extra else "")
                    if s.get("sign_date"):
                        t += f" {s['sign_date']}"
                    if s.get("has_seal"):
                        t += " +dấu"
                    ss.append(t)
                bits.append("ký: " + "; ".join(ss))
            other = [f"{p}={fmt(v)}" for p, v in flatten({k: v for k, v in doc["data"].items()
                                                         if k not in consumed})]
            if other:
                bits.append("khác: " + "; ".join(other))
            items = ", ".join(f"{i}{'*' if r else ''}" for i, r in doc["items"])
            bits.append(f"mục checklist: {items}")
            w(" · ".join(bits))
        if self.items_without_record:
            w("Mục checklist không có chứng từ: " + ", ".join(
                f"{i}{'*' if r else ''}" for i, r in self.items_without_record))
        w("(* = mục bắt buộc)\n")

        # người
        w("## Người liên quan")
        for n, x in G.nodes(data=True):
            if x.get("kind") != "party":
                continue
            head = f"{n} {x['name'] or '(chưa xác định danh tính)'}"
            if x.get("national_id"):
                head += f" · CCCD {x['national_id']}"
            w(head)
            roles = defaultdict(list)
            for r, raw, d in x["roles"]:
                roles[f"{r}«{raw}»" if raw else str(r)].append(d)
            w("  vai trò: " + "; ".join(f"{r} [{','.join(ds)}]" for r, ds in roles.items()))
            for attr, obs in x["obs"].items():
                w(f"  {attr}: " + self._groups(attr, obs))
        w("")
        w("Liên kết mention → người (bằng chứng trong chứng từ):")
        for mt in self.mentions:
            line = f"  {mt['doc']}#{mt['idx']} {mt['role']} → {mt['party']} ({mt['confidence']}: " \
                   f"{', '.join(mt['evidence']) or '—'})"
            ag = [f"{p}: {', '.join(r)}" for p, r in mt["against"] if r]
            if ag:
                line += " · loại " + "; ".join(ag)
            w(line)
        w("")

        # quan hệ
        w("## Quan hệ")
        merged: "OrderedDict[tuple, dict]" = OrderedDict()
        for u, v, e in G.edges(data=True):
            if e["rel"] in ("MENTIONS", "HAS_DOCUMENT", "CIC_QUERIED_BY", "EVIDENCES"):
                continue
            m = merged.setdefault((u, e["rel"], v), {"src": [], "extra": []})
            m["src"] += [s for s in e.get("src", []) if s not in m["src"]]
            for k in ("role", "matched_by", "usage", "ownership_form", "is_current_owner",
                      "owner_names_raw", "registration_date", "place"):
                if e.get(k) is not None:
                    t = f"{k}={fmt(e[k])}" + (f" ({','.join(e['src'])})" if len(e.get("src", [])) == 1
                                              and e["rel"] in ("OWNS",) else "")
                    if t not in m["extra"]:
                        m["extra"].append(t)
        for (u, rel, v), m in merged.items():
            w(f"{u} -{rel}-> {v} [{','.join(m['src'])}]" + (f" {'; '.join(m['extra'])}" if m["extra"] else ""))
        w("")

        # khoản vay
        for lid in self.loans:
            x = G.nodes[lid]
            w(f"## Khoản vay đề nghị {lid} [{x['src']}]")
            sec = None
            for k, v in x["attrs"].items():
                s0, rest = k.split(".", 1)
                if s0 != sec:
                    sec = s0
                    w(f"  {sec}:")
                w(f"    {rest}: {fmt(v)}")
            w("")

        # hộ kinh doanh
        for bid in self.businesses:
            x = G.nodes[bid]
            w(f"## Hộ kinh doanh {bid} {x['name']}")
            for attr, obs in x["obs"].items():
                w(f"  {attr}: " + self._groups(attr, obs))
            w("")

        # phương án vốn
        for gid in self.plans:
            x = G.nodes[gid]
            w(f"## Phương án sử dụng vốn {gid} [{x['src']}] · tổng ghi trên chứng từ {fmt(x['total'])}")
            w("  # | mặt hàng | ĐVT | SL | đơn giá | thành tiền")
            for it in x["items"]:
                w(f"  {it.get('item_no')} | {it.get('item_name')} | {it.get('unit')} | {fmt(it.get('quantity'))} | "
                  f"{fmt(it.get('unit_price'))} | {fmt(it.get('amount'))}")
            w("")

        # tài sản
        for n, x in G.nodes(data=True):
            if x.get("kind") != "asset":
                continue
            w(f"## Tài sản {n} {x['asset_type']} · GCN {x['certificate_number']}")
            for attr, obs in x["obs"].items():
                w(f"  {attr}: " + self._groups(attr, obs))
            if x.get("case_value") is not None:
                w(f"  asset_value: {fmt(x['case_value'])} [nguồn: case.assets — không gắn với bản ghi chứng từ nào]")
            w("")

        # CIC
        for code, subj, rep in self.cic:
            w(f"## Báo cáo CIC [{code}] · chủ thể: {subj} (theo liên kết mention ở trên)")
            for p, v in flatten({k: v for k, v in rep.items() if k != "queried_institutions"}):
                w(f"  {p}: {fmt(v)}")
            for u, v, e in G.out_edges(subj, data=True):
                if e["rel"] == "CIC_QUERIED_BY" and code in e["src"]:
                    w(f"  tra cứu bởi {G.nodes[v]['name']}: {', '.join(sorted(d for d in e['dates'] if d))}")
            w("")

        if derived:
            w("## Số học thuần (tính từ các số trên, không phải đánh giá)")
            for line in self._derived():
                w("  " + line)
            w("")
        return "\n".join(out).rstrip() + "\n"

    def _groups(self, attr, obs):
        groups: "OrderedDict[str, list]" = OrderedDict()
        for v, d in obs:
            if v is None:
                continue
            groups.setdefault(value_key(attr, v), []).append((v, d))
        parts = []
        for vals in groups.values():
            docs = sorted({d for _, d in vals}, key=lambda s: (s[0], int(s[1:]) if s[1:].isdigit() else 0))
            variants = {fmt(v) for v, _ in vals}
            rep = max(variants, key=len) if is_address(vals[0][0]) else fmt(vals[0][0])
            tag = f" ≈{len(variants)}" if len(variants) > 1 else ""
            parts.append(f"{rep} [{','.join(docs)}]{tag}")
        return " | ".join(parts)

    def _derived(self):
        G, lines = self.G, []
        for gid in self.plans:
            x = G.nodes[gid]
            s = sum((it.get("amount") or 0) for it in x["items"])
            lines.append(f"{gid}: tổng thành tiền các dòng = {fmt(s)} (chứng từ ghi {fmt(x['total'])})")
            bad = [it.get("item_no") for it in x["items"]
                   if it.get("quantity") and it.get("unit_price") and it.get("amount")
                   and it["quantity"] * it["unit_price"] != it["amount"]]
            lines.append(f"{gid}: dòng có SL×đơn giá ≠ thành tiền: {bad or 'không có'}")
        for lid in self.loans:
            a = G.nodes[lid]["attrs"]
            amt = a.get("loan_info.requested_amount")
            for _, aid, e in G.out_edges(lid, data=True):
                if e["rel"] == "SECURED_BY" and amt and G.nodes[aid].get("case_value"):
                    lines.append(f"{lid}/{aid}: số tiền vay ÷ asset_value = {amt / G.nodes[aid]['case_value']:.4f}")
            inc, per = a.get("financial_info.total_income"), a.get("financial_info.total_income_period")
            if inc and per == "MONTHLY":
                lines.append(f"{lid}: thu nhập khai trong đơn quy năm = {fmt(inc * 12)}")
            for _, bid, e in G.out_edges(lid, data=True):
                if e["rel"] != "FOR_BUSINESS":
                    continue
                ob = G.nodes[bid]["obs"]
                for k in ("net_revenue_annual", "net_profit_annual", "cogs_annual"):
                    if ob.get(k) and amt:
                        v = ob[k][0][0]
                        lines.append(f"{lid}/{bid}: số tiền vay ÷ {k} = {amt / v:.2f}")
            term = a.get("loan_info.loan_term_months")
            if term:
                lines.append(f"{lid}: kỳ hạn = {term / 12:g} năm")
        return lines


# ----------------------------------------------------------------------------- main

def load(path: Path) -> dict:
    from lac.adapters.du_integration_v5 import to_lac_input  # kiểm cấu trúc đầu vào DU v5
    return to_lac_input(json.loads(path.read_text(encoding="utf-8")))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("."))
    ap.add_argument("--derived", action="store_true", help="thêm khối số học thuần (tổng, tỷ lệ)")
    args = ap.parse_args()

    data = load(args.input)
    cg = CaseGraph(data)
    G = cg.build()
    ctx = cg.render(derived=args.derived)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "llm_context.md").write_text(ctx, encoding="utf-8")
    try:
        gj = nx.node_link_data(G, edges="edges")
    except TypeError:  # networkx < 3.4
        gj = nx.node_link_data(G)
    (args.out / "graph.json").write_text(json.dumps(jsonable(gj), ensure_ascii=False, indent=1), encoding="utf-8")

    dossier_only = {k: v for k, v in data.items() if k not in EXCLUDED_TOP_LEVEL}
    raw_all = json.dumps(data, ensure_ascii=False)
    raw_dossier = json.dumps(dossier_only, ensure_ascii=False)
    print(f"nodes={G.number_of_nodes()} edges={G.number_of_edges()} "
          f"docs={len(cg.docs)} (từ {len(data['documents']['records'])} bản ghi) "
          f"mentions={len(cg.mentions)} unresolved={cg.unresolved}")
    print(f"{'JSON gốc (cả findings/checks)':34s} {len(raw_all):>7,} ký tự ≈ {approx_tokens(raw_all):>6,} token")
    print(f"{'JSON chỉ thông tin hồ sơ':34s} {len(raw_dossier):>7,} ký tự ≈ {approx_tokens(raw_dossier):>6,} token")
    print(f"{'llm_context.md':34s} {len(ctx):>7,} ký tự ≈ {approx_tokens(ctx):>6,} token")


if __name__ == "__main__":
    main()
