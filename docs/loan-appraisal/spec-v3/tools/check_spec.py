#!/usr/bin/env python3
"""Kiểm tra spec-v3. Thoát 0 khi đạt, 1 khi có lỗi.

Dùng: python tools/check_spec.py [--only catalogs|links|stages|ui|backlog]

Nhóm kiểm tra
  catalogs  JSON đọc được; tham chiếu chéo giữa các catalog; không còn key legacy.
  links     Mọi liên kết tương đối trong *.md trỏ tới file tồn tại; README liệt kê đủ file.
  stages    6 file stage: rule/AC có ID duy nhất, AC trỏ rule có thật, task card đủ mục.
  ui        4 file UI + cross_cutting: như stages, và mọi ID tham chiếu có định nghĩa.
  backlog   build_backlog --check; BACKLOG.md khớp với task card hiện tại.
  (không --only) chạy tất cả + kiểm ID toàn cục, PII/credential mẫu.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "03_catalogs"
ERR: list[str] = []


def err(msg: str) -> None:
    ERR.append(msg)


FENCE = re.compile(r"^```.*?^```", re.S | re.M)


def rd(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def rd_nofence(p: Path) -> str:
    """Nội dung đã bỏ khối ```code``` (ví dụ mẫu không được tính là định nghĩa)."""
    return FENCE.sub("", rd(p))


def jl(p: Path):
    try:
        return json.loads(rd(p))
    except Exception as e:  # noqa: BLE001
        err(f"{p.relative_to(ROOT)}: JSON không đọc được: {e}")
        return None


def all_md() -> list[Path]:
    return sorted(p for p in ROOT.rglob("*.md") if "node_modules" not in p.parts)


# ───────────────────────── catalogs ─────────────────────────
LEGACY_TOKENS = ["`previous_operation_id`", "legacy_key", "old_key", "\"deprecated_alias\""]


def check_programs(cl, enums) -> None:
    """S4-R24 (D-37): chương trình checklist theo sản phẩm, mỗi chương trình tự khai báo luồng."""
    p = CAT / "checklist_programs.json"
    data = jl(p) if p.exists() else None
    if data is None:
        err("thiếu/không đọc được 03_catalogs/checklist_programs.json")
        return
    items = {i["item_key"]: i for i in cl["items"]}
    reqs = set(enums["FlowRequirement"])
    keys, products = set(), {}
    if not data.get("programs"):
        err("checklist_programs.json: không có chương trình nào")
    for prog in data.get("programs", []):
        k = prog["program_key"]
        if not re.fullmatch(r"[a-z][a-z0-9_]*", k):
            err(f"program {k}: program_key phải dạng snake_case")
        if k in keys:
            err(f"program {k}: trùng program_key")
        keys.add(k)
        if not prog["product_codes"]:
            err(f"program {k}: product_codes rỗng")
        for pc in prog["product_codes"]:
            if pc in products:
                err(f"product_code {pc} thuộc 2 chương trình ({products[pc]}, {k})")
            products[pc] = k
        flows = [f["flow_key"] for f in prog["flows"]]
        if not flows:
            err(f"program {k}: không có luồng")
        if len(flows) != len(set(flows)):
            err(f"program {k}: flow_key trùng")
        for fk in flows:
            if not re.fullmatch(r"[A-Z][A-Z0-9_]*", fk):
                err(f"program {k}: flow_key {fk} phải viết HOA (A-Z, 0-9, _)")
        for ik, by_flow in prog["requirements"].items():
            if ik not in items:
                err(f"program {k}: item_key lạ {ik}")
                continue
            if set(by_flow) != set(flows):
                err(f"program {k}.{ik}: phải khai đủ đúng các luồng {flows}")
            for fk, v in by_flow.items():
                if v is not None and v not in reqs:
                    err(f"program {k}.{ik}.{fk}: giá trị lạ {v}")
                if v == "CONDITIONAL" and not items[ik].get("condition_id"):
                    err(f"program {k}.{ik}.{fk}: CONDITIONAL cần item có condition_id")


def check_catalogs() -> None:
    names = ["enums", "doc_types", "reason_codes", "checklist_catalog", "cross_check_matrix", "sl_fields"]
    data = {}
    for n in names:
        p = CAT / f"{n}.json"
        if not p.exists():
            err(f"thiếu 03_catalogs/{n}.json")
            continue
        data[n] = jl(p)
        if "legacy" in rd(p).lower():
            err(f"03_catalogs/{n}.json còn chữ 'legacy'")
    if len(data) < len(names) or any(v is None for v in data.values()):
        return
    enums = data["enums"]["enums"]
    doc_types = {d["doc_type_key"]: d for d in data["doc_types"]["doc_types"]}
    if len(doc_types) != len(data["doc_types"]["doc_types"]):
        err("doc_types.json: doc_type_key trùng")
    if len(doc_types) != 47:
        err(f"doc_types.json: kỳ vọng 47 loại, thực tế {len(doc_types)}")
    ext = {k for k, v in doc_types.items() if v["needs_extraction"]}
    if set(enums["ExtractableDocTypeKey"]) != ext:
        err("enums.ExtractableDocTypeKey không khớp doc_types(needs_extraction=true)")
    # D-32: loại chỉ nhận diện được bóc tách nhẹ theo light_extraction.json (S2-R20)
    for k, v in doc_types.items():
        want = "FULL" if v["needs_extraction"] else "LIGHT"
        if v.get("extraction_level") != want:
            err(f"doc_types {k}: extraction_level phải là {want}")
    # D-70: danh mục key_facts cố định của S1, chỉ cho loại FULL; ≤ 5 key, riêng loan_application ≤ 7.
    vocab = set(enums.get("SummaryFieldKey", []))
    if not vocab:
        err("enums.json: thiếu SummaryFieldKey")
    for k, v in doc_types.items():
        sf = v.get("summary_fields")
        if v["extraction_level"] != "FULL":
            if sf is not None:
                err(f"doc_types {k}: summary_fields chỉ dành cho loại FULL")
            continue
        if not sf:
            err(f"doc_types {k}: thiếu summary_fields")
            continue
        limit = 7 if k == "loan_application" else 5
        if len(sf) > limit:
            err(f"doc_types {k}: summary_fields {len(sf)} key, tối đa {limit}")
        if len(set(sf)) != len(sf):
            err(f"doc_types {k}: summary_fields trùng key")
        for key in sf:
            if key not in vocab:
                err(f"doc_types {k}: summary_fields '{key}' không có trong enums.SummaryFieldKey")
    lp = CAT / "light_extraction.json"
    light = jl(lp) if lp.exists() else None
    if light is None:
        err("thiếu/không đọc được 03_catalogs/light_extraction.json")
    else:
        lk = [d["doc_type_key"] for d in light["doc_types"]]
        if sorted(lk) != sorted(k for k in doc_types if k not in ext):
            err("light_extraction.json: danh sách loại không khớp các loại needs_extraction=false")
        for d in light["doc_types"]:
            if d["subject_party_role"] not in enums["PartyRole"]:
                err(f"light {d['doc_type_key']}: party_role lạ {d['subject_party_role']}")
            if d["subject_party_type"] not in enums["PartyType"]:
                err(f"light {d['doc_type_key']}: party_type lạ {d['subject_party_type']}")
            fk = [f["key"] for f in d["fields"]]
            if len(fk) != len(set(fk)):
                err(f"light {d['doc_type_key']}: key trùng")
            for f in d["fields"]:
                if f["value_type"] not in ("TEXT", "DATE", "MONEY", "ADDRESS"):
                    err(f"light {d['doc_type_key']}.{f['key']}: value_type lạ {f['value_type']}")
    groups = {g["checklist_group"] for g in data["checklist_catalog"]["groups"]}
    if groups != set(enums["ChecklistGroup"]):
        err("checklist groups không khớp enums.ChecklistGroup")
    cl = data["checklist_catalog"]
    cond_ids = {c["condition_id"] for c in cl["conditions"]}
    item_keys = [i["item_key"] for i in cl["items"]]
    if len(item_keys) != len(set(item_keys)):
        err("checklist: item_key trùng")
    for i in cl["items"]:
        if i["checklist_group"] not in groups:
            err(f"checklist {i['item_key']}: nhóm lạ {i['checklist_group']}")
        for d in i["accepted_doc_type_keys"]:
            if d not in doc_types:
                err(f"checklist {i['item_key']}: doc_type_key lạ {d}")
        if i.get("condition_id") and i["condition_id"] not in cond_ids:
            err(f"checklist {i['item_key']}: condition_id lạ {i['condition_id']}")
    for c in cl["conditions"]:
        for part in c.get("part_condition_ids") or []:
            if part not in cond_ids:
                err(f"condition {c['condition_id']}: part lạ {part}")
    check_programs(cl, enums)
    codes = {c["code"] for c in data["reason_codes"]["reason_codes"]} if "reason_codes" in data["reason_codes"] else set()
    if not codes:
        err("reason_codes.json: không đọc được danh sách mã")
    if "SL_VALUE_FROM_OCR" not in codes:
        err("reason_codes.json: thiếu SL_VALUE_FROM_OCR (S6-R07)")
    for f in data["sl_fields"]["fields"]:
        for s in f["ocr_sources"]:
            if s["doc_type_key"] not in doc_types:
                err(f"sl_fields {f['field_key']}: doc_type_key lạ {s['doc_type_key']}")
    sch = CAT / "doc_schemas"
    for n in ("_common", "_enums"):
        if not (sch / f"{n}.schema.json").exists():
            err(f"thiếu doc_schemas/{n}.schema.json")
    schema_files = sorted(p for p in sch.glob("*.schema.json") if not p.name.startswith("_"))
    if len(schema_files) != 27:
        err(f"doc_schemas: kỳ vọng 27 schema chứng từ, thực tế {len(schema_files)}")
    if {p.name.replace(".schema.json", "") for p in schema_files} != ext:
        err("doc_schemas: tập schema không khớp ExtractableDocTypeKey")
    check_field_paths(sch, data["cross_check_matrix"], data["sl_fields"])
    for p in schema_files:
        key = p.name.replace(".schema.json", "")
        if key not in ext:
            err(f"doc_schemas/{p.name}: loại không có trong ExtractableDocTypeKey")
        jl(p)
    for p in CAT.rglob("*.json"):
        t = rd(p)
        for tok in LEGACY_TOKENS:
            if tok in t:
                err(f"{p.relative_to(ROOT)}: còn token legacy {tok}")


def _schema_files(sch: Path) -> dict:
    return {p.name: json.loads(rd(p)) for p in sch.glob("*.schema.json")}


def _resolve(node, doc: str, files: dict, depth: int = 0) -> list[tuple[dict, str]]:
    """Trả mọi nhánh (node, file) sau khi theo $ref / allOf / oneOf / anyOf."""
    if depth > 20 or not isinstance(node, dict):
        return []
    out: list[tuple[dict, str]] = [(node, doc)]
    if "$ref" in node:
        target, _, ptr = node["$ref"].partition("#")
        tdoc = target or doc
        cur = files.get(tdoc)
        for part in [x for x in ptr.split("/") if x]:
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur is not None:
            out += _resolve(cur, tdoc, files, depth + 1)
    for k in ("allOf", "oneOf", "anyOf"):
        for sub in node.get(k, []):
            out += _resolve(sub, doc, files, depth + 1)
    return out


def _path_exists(root: dict, doc: str, files: dict, path: str) -> bool:
    """`data.a[].b.c` → đi theo properties / items qua mọi nhánh của schema."""
    parts = path.split(".")
    if parts and parts[0] == "data":
        parts = parts[1:]
    frontier = _resolve(root, doc, files)
    for part in parts:
        is_arr = part.endswith("[]")
        name = part[:-2] if is_arr else part
        nxt: list[tuple[dict, str]] = []
        for node, nd in frontier:
            prop = (node.get("properties") or {}).get(name)
            if prop is None:
                continue
            branches = _resolve(prop, nd, files)
            if is_arr:
                items = [(n.get("items"), d2) for n, d2 in branches if isinstance(n.get("items"), dict)]
                branches = [b for it, d2 in items for b in _resolve(it, d2, files)]
            nxt += branches
        if not nxt:
            return False
        frontier = nxt
    return True


def check_field_paths(sch: Path, matrix: dict, sl: dict) -> None:
    """Mọi field_path mà ma trận đối chiếu / sl_fields trỏ tới phải có trong schema của loại (D-33)."""
    files = _schema_files(sch)
    refs: list[tuple[str, str, str]] = []

    def walk(o, where):
        if isinstance(o, dict):
            if isinstance(o.get("doc_type_key"), str) and isinstance(o.get("field_path"), str):
                refs.append((o["doc_type_key"], o["field_path"], where))
                if isinstance(o.get("index_field_path"), str):
                    refs.append((o["doc_type_key"], o["index_field_path"], where))
            for v in o.values():
                walk(v, where)
        elif isinstance(o, list):
            for v in o:
                walk(v, where)

    walk(matrix, "cross_check_matrix")
    walk(sl, "sl_fields")
    for key, path, where in refs:
        name = f"{key}.schema.json"
        if name not in files:
            continue  # loại LIGHT: kiểm ở light_extraction.json
        if not _path_exists(files[name], name, files, path):
            err(f"{where}: {key} → {path} không có trong doc_schemas/{name}")
    try:
        from jsonschema import Draft202012Validator  # type: ignore
    except Exception:  # noqa: BLE001
        return
    for name, s in files.items():
        try:
            Draft202012Validator.check_schema(s)
        except Exception as e:  # noqa: BLE001
            err(f"doc_schemas/{name}: không phải JSON Schema 2020-12 hợp lệ: {str(e).splitlines()[0]}")


# ───────────────────────── links ─────────────────────────
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def check_links() -> None:
    for p in all_md():
        for m in LINK_RE.finditer(rd(p)):
            target = m.group(1)
            if re.match(r"^(https?:|mailto:|#)", target):
                continue
            path = target.split("#")[0]
            if not path:
                continue
            if not (p.parent / path).resolve().exists():
                err(f"{p.relative_to(ROOT)}: liên kết hỏng → {target}")
    readme = rd(ROOT / "README.md")
    for need in ("01_overview.md", "02_conventions.md", "04_data_model.md", "BACKLOG.md", "open_questions.md", "PLAN.md", "IMPLEMENT.md"):
        if need not in readme:
            err(f"README.md không nhắc tới {need}")
    for need in ("stages/", "ui/", "cross_cutting/", "03_catalogs/"):
        if need not in readme:
            err(f"README.md không nhắc tới {need}")


# ───────────────────────── stages / ui ─────────────────────────
RULE_DEF = re.compile(r"^(?:\|\s*)?\*\*([A-Z]+[0-9]*-R\d+|D-\d+|M-\d+)\*\*\s*(?:\||—)", re.M)
AC_DEF = re.compile(r"^\|\s*([SU]\d-AC\d+)\s*\|", re.M)
TASK_HEAD = re.compile(r"^### (T-[A-Z0-9]+-(?:\d+))\s+—\s+(.*)$", re.M)
REF_ID = re.compile(r"\b(?:[SU]\d-R\d+|[SU]\d-AC\d+|S-R\d+|R-R\d+|A-R\d+|F-R\d+|TS-R\d+|D-\d+|M-\d+)\b")
REQUIRED_FIELDS = ["Depends", "Files", "Refs", "Làm", "DoD", "Verify"]
NO_FILES_OK = {"T-SEC-05", "T-TEST-04"}
NO_REFS_OK: set[str] = set()


def card_blocks(text: str):
    heads = list(TASK_HEAD.finditer(text))
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        nxt = re.search(r"^## ", text[m.end():end], re.M)
        if nxt:
            end = m.end() + nxt.start()
        yield m.group(1), text[m.end():end]


def check_cards(files: list[Path], defined_rules: set[str], defined_ac: set[str]) -> None:
    for p in files:
        t = rd_nofence(p)
        rel = p.relative_to(ROOT).as_posix()
        rules = RULE_DEF.findall(t)
        if len(rules) != len(set(rules)):
            dup = {r for r in rules if rules.count(r) > 1}
            err(f"{rel}: rule trùng ID {sorted(dup)}")
        acs = AC_DEF.findall(t)
        if len(acs) != len(set(acs)):
            err(f"{rel}: AC trùng ID")
        for tid, block in card_blocks(t):
            for f in REQUIRED_FIELDS:
                if not re.search(rf"^- {f}\b[^:\n]*:", block, re.M):
                    if f == "Files" and tid in NO_FILES_OK:
                        continue
                    if f == "Refs" and tid in NO_REFS_OK:
                        continue
                    err(f"{rel}: {tid} thiếu mục '{f}'")
            m = re.search(r"^- Verify:\s*(.*)$", block, re.M)
            if m and not m.group(1).strip():
                err(f"{rel}: {tid} Verify rỗng")
            dod = re.search(r"^- DoD\b[^:\n]*:(.*?)(?=^- Verify:|\Z)", block, re.S | re.M)
            if dod and len([l for l in dod.group(1).splitlines() if l.strip().startswith("-") or l.strip()]) > 12:
                err(f"{rel}: {tid} DoD dài > 12 dòng (tách task)")
            ref = re.search(r"^- Refs:\s*(.*)$", block, re.M)
            if ref:
                for rid in REF_ID.findall(ref.group(1)):
                    if rid not in defined_rules and rid not in defined_ac:
                        err(f"{rel}: {tid} Refs trỏ tới {rid} chưa định nghĩa")
        # AC phải trỏ rule có thật (cột cuối)
        for line in t.splitlines():
            m = re.match(r"^\|\s*([SU]\d-AC\d+)\s*\|.*\|\s*([^|]+?)\s*\|\s*$", line)
            if m:
                for rid in re.findall(r"\bR\d+\b", m.group(2)):
                    prefix = m.group(1).split("-")[0]
                    if f"{prefix}-{rid}" not in defined_rules:
                        err(f"{rel}: {m.group(1)} trỏ {prefix}-{rid} không tồn tại")


def collect_defs() -> tuple[set[str], set[str]]:
    rules: set[str] = set()
    acs: set[str] = set()
    for p in all_md():
        if p.name in ("IMPLEMENT.md", "PLAN.md"):
            continue
        t = rd_nofence(p)
        rules.update(RULE_DEF.findall(t))
        acs.update(AC_DEF.findall(t))
    return rules, acs


def check_stages() -> None:
    rules, acs = collect_defs()
    files = sorted((ROOT / "stages").glob("S*.md"))
    if len(files) != 6:
        err(f"stages/: kỳ vọng 6 file, thực tế {len(files)}")
    check_cards(files, rules, acs)
    for p in files:
        n = p.name[1]
        t = rd(p)
        if f"S{n}-R01" not in t:
            err(f"{p.name}: không có rule S{n}-R01")
        if not re.search(rf"\bS{n}-AC01\b", t):
            err(f"{p.name}: không có AC S{n}-AC01")


def check_ui() -> None:
    rules, acs = collect_defs()
    ui = sorted((ROOT / "ui").glob("U*.md"))
    if len(ui) != 4:
        err(f"ui/: kỳ vọng 4 file, thực tế {len(ui)}")
    cc = sorted((ROOT / "cross_cutting").glob("*.md"))
    for need in ("api.md", "rbac.md", "security.md", "test.md", "foundation.md"):
        if not (ROOT / "cross_cutting" / need).exists():
            err(f"cross_cutting/{need} chưa có")
    check_cards(ui + cc + [ROOT / "04_data_model.md"], rules, acs)
    for p in ui:
        n = p.name[1]
        t = rd(p)
        if not re.search(rf"\bU{n}-R01\b", t) or not re.search(rf"\bU{n}-AC01\b", t):
            err(f"{p.name}: thiếu U{n}-R01 hoặc U{n}-AC01")
    # Mọi mã rule/AC được nhắc trong văn bản (ngoài Refs) phải tồn tại
    for p in all_md():
        if p.name in ("IMPLEMENT.md", "PLAN.md"):
            continue
        t = rd(p)
        for rid in set(re.findall(r"\b(?:[SU]\d-R\d+|S-R\d+|R-R\d+|A-R\d+|F-R\d+|TS-R\d+)\b", t)):
            if rid not in rules:
                err(f"{p.relative_to(ROOT)}: nhắc tới {rid} nhưng không có định nghĩa")
        for rid in set(re.findall(r"\b[SU]\d-AC\d+\b", t)):
            if rid not in acs:
                err(f"{p.relative_to(ROOT)}: nhắc tới {rid} nhưng không có định nghĩa")


# ───────────────────────── backlog ─────────────────────────
def check_backlog() -> None:
    # Ép tiến trình con in UTF-8: trên Windows stdout mặc định theo code page console (cp1258…).
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_backlog.py"), "--check"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if r.returncode != 0:
        err("build_backlog --check lỗi:\n" + r.stdout + r.stderr)
        return
    spec_path = ROOT / "tools" / "build_backlog.py"
    import importlib.util
    spec = importlib.util.spec_from_file_location("bb", spec_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    tasks, e = mod.parse()
    wv, e2 = mod.waves(tasks)
    if e or e2:
        err("backlog: " + "; ".join(e + e2))
        return
    expected = mod.render(tasks, wv)
    cur = ROOT / "BACKLOG.md"
    if not cur.exists() or rd(cur) != expected:
        err("BACKLOG.md không khớp task card hiện tại — chạy: python tools/build_backlog.py")
    all_t = set(tasks)
    for p in all_md():
        if p.name in ("BACKLOG.md", "IMPLEMENT.md", "PLAN.md"):
            continue
        for tid in set(re.findall(r"\bT-[A-Z0-9]+-\d+\b", rd(p))):
            if tid not in all_t:
                err(f"{p.relative_to(ROOT)}: nhắc tới task {tid} chưa định nghĩa")


# ───────────────────────── toàn cục ─────────────────────────
def check_global() -> None:
    seen: dict[str, str] = {}
    for p in all_md():
        if p.name in ("IMPLEMENT.md", "PLAN.md", "BACKLOG.md"):
            continue
        for tid, _ in card_blocks(rd_nofence(p)):
            if tid in seen:
                err(f"task {tid} định nghĩa ở {seen[tid]} và {p.relative_to(ROOT)}")
            seen[tid] = p.relative_to(ROOT).as_posix()
    # PII/credential mẫu
    cred = re.compile(r"dg_[A-Za-z0-9_-]{30,}")
    long_id = re.compile(r"(?<![\d.])\d{9}(?![\d])|(?<![\d.])\d{12}(?![\d])")
    phone = re.compile(r"(?<!\d)0(?:3|5|7|8|9)\d{8}(?!\d)")
    for p in list(all_md()) + list(CAT.rglob("*.json")):
        t = rd(p)
        rel = p.relative_to(ROOT).as_posix()
        if cred.search(t):
            err(f"{rel}: giống API key DUGate")
        for m in long_id.finditer(t):
            s = m.group(0)
            if s.count("0") >= 7 or s in ("123456789", "123456789012", "012345678", "012345678901"):
                continue  # fixture giả: số tròn / nhiều số 0 / dãy tuần tự
            ctx = t[max(0, m.start() - 20): m.end() + 5].replace("\n", " ")
            err(f"{rel}: chuỗi số giống CMND/CCCD '{s}' ({ctx.strip()})")
        for m in phone.finditer(t):
            if m.group(0) == "0900000000":
                continue
            err(f"{rel}: chuỗi giống số điện thoại thật '{m.group(0)}'")


CHECKS = {"catalogs": check_catalogs, "links": check_links, "stages": check_stages, "ui": check_ui, "backlog": check_backlog}


def main() -> int:
    # Console Windows (cp1258…) không mã hóa được mọi ký tự tiếng Việt dựng sẵn → thay thế thay vì crash.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
        if only not in CHECKS:
            print(f"--only phải thuộc {sorted(CHECKS)}")
            return 2
    for name, fn in CHECKS.items():
        if only and name != only:
            continue
        before = len(ERR)
        fn()
        print(f"[{'OK ' if len(ERR) == before else 'FAIL'}] {name}")
    if not only:
        before = len(ERR)
        check_global()
        print(f"[{'OK ' if len(ERR) == before else 'FAIL'}] global")
    if ERR:
        print(f"\n{len(ERR)} lỗi:")
        for e in ERR:
            print(" -", e)
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
