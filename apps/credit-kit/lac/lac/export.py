"""Gộp kết quả LAC thành một `lac.json` theo contracts/lac.schema.json (v1.0).

  python -m lac.export case.json -o out/lac.json --ref-date 2026-10-23 [--config pp-hkd-secured@0.1.0]
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path

from lac.config import Config, load_config
from lac.graph import approx_tokens, jsonable, load
from lac.validate import Validator

SCHEMA_VERSION = "1.0"
ENTITY_KINDS = ("party", "business", "asset", "loan_request", "funding_plan", "institution")
LINK_SKIP = {"HAS_DOCUMENT", "MENTIONS"}  # lần nhắc người xuất riêng ở "mentions"


def build_lac(data: dict, ref_date: date | None = None, config: Config | None = None,
              cic_max_age: int | None = None, interest_rate: float | None = None) -> dict:
    from lac.phase1 import phase1_gate
    from lac.signals import compute_metrics, compute_signals
    cfg = config or load_config()
    v = Validator(data, ref_date, cic_max_age, cfg).run()
    metrics = compute_metrics(v, interest_rate)
    return lac_from_validator(v, phase1=phase1_gate(v), signals=compute_signals(v, metrics), metrics=metrics)


def lac_from_validator(v: Validator, phase1: dict | None = None, signals: list | None = None,
                       metrics: list | None = None) -> dict:
    G, cg, cfg = v.G, v.cg, v.cfg
    c = G.nodes["CASE"]
    documents = []
    for code, doc in cg.docs.items():
        li = doc["data"].get("legal_info") or {}
        d = v.doc_dates.get(code)
        documents.append({"id": code, "doc_type": doc["type"], "title": li.get("document_title"),
                          "date": d.isoformat() if d else None,
                          "checklist_items": [{"key": k, "required": r} for k, r in doc["items"]]})
    entities = []
    for n, x in G.nodes(data=True):
        if x.get("kind") not in ENTITY_KINDS:
            continue
        e = {"id": n, "kind": x["kind"]}
        if x["kind"] == "party":
            e.update(entity_type=x.get("entity_type"), name=x.get("name"),
                     roles=[{"role": r, "role_raw": raw, "doc": dd} for r, raw, dd in x.get("roles", [])])
        elif x["kind"] in ("business", "institution"):
            e["name"] = x.get("name")
        elif x["kind"] == "asset":
            e["entity_type"] = x.get("asset_type")
        elif x["kind"] in ("loan_request", "funding_plan"):
            e["src"] = x.get("src")
        entities.append(e)
    mentions = [{"doc": m["doc"], "idx": m["idx"], "party": m["party"], "role": m["role"],
                 "confidence": m["confidence"], "score": m["score"], "evidence": list(m["evidence"]),
                 "against": jsonable(m["against"])} for m in cg.mentions]
    links = []
    for u, w, e in G.edges(data=True):
        if e["rel"] in LINK_SKIP:
            continue
        attrs = {k: jsonable(val) for k, val in e.items() if k not in ("rel", "src") and val is not None}
        links.append({"source": u, "target": w, "type": e["rel"], "sources": list(e.get("src", [])),
                      "attrs": attrs})
    disc = jsonable(v.disc)
    rest = [x for x in disc if x["class"] != "N"]
    ctx = v.branch2_context()
    if metrics or signals:
        from lac.signals import render_branch2_extra
        ctx += "\n" + render_branch2_extra(metrics or [], signals or [])
    return {
        "schema": "lac", "version": SCHEMA_VERSION,
        "case": {"id": c.get("case_id"), "product": c.get("product"), "segment": c.get("segment"),
                 "flow": c.get("flow"), "ref_date": v.ref.isoformat(),
                 "config": {"product": cfg.product, "version": cfg.version, "status": cfg.status},
                 "phase1": phase1},
        "documents": documents,
        "entities": entities,
        "mentions": mentions,
        "links": links,
        "facts": v.facts_json(),
        "discrepancies": disc,
        "signals": signals or [],
        "metrics": metrics or [],
        "branch2": {"markdown": ctx, "approx_tokens": approx_tokens(ctx)},
        "stats": {"facts": len(v.facts), "discrepancies": len(rest), "n_variants": len(disc) - len(rest),
                  "by_severity": dict(sorted(Counter(x["severity"] for x in rest).items())),
                  "by_class": dict(sorted(Counter(x["class"] for x in rest).items())),
                  "to_branch2": sum(1 for x in rest if x["to_branch2"]),
                  "unresolved_mentions": cg.unresolved},
    }


def dumps(lac: dict) -> str:
    """Tuần tự hoá ổn định (cùng LAC -> cùng byte)."""
    return json.dumps(lac, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("lac.json"))
    ap.add_argument("--ref-date", type=date.fromisoformat, default=None)
    ap.add_argument("--cic-max-age", type=int, default=None)
    ap.add_argument("--config", default=None, help="sản phẩm@version, vd pp-hkd-secured@0.1.0")
    ap.add_argument("--interest-rate", type=float, default=None, help="lãi suất năm dạng số (vd 0.1) nếu LOS cung cấp")
    a = ap.parse_args()
    cfg = load_config(*a.config.split("@")) if a.config else load_config()
    lac = build_lac(load(a.input), a.ref_date, cfg, a.cic_max_age, a.interest_rate)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(dumps(lac), encoding="utf-8")
    s = lac["stats"]
    print(f"lac.json: facts={s['facts']} discrepancies={s['discrepancies']} (+{s['n_variants']} N) "
          f"{s['by_severity']} branch2≈{lac['branch2']['approx_tokens']} token")



if __name__ == "__main__":
    main()
