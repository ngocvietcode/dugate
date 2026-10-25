import json
import os
from datetime import date
from pathlib import Path

import networkx as nx
import pytest

from lac.graph import CaseGraph, jsonable, load
from lac.validate import Validator

TESTS = Path(__file__).resolve().parent
FIXTURES = TESTS / "fixtures"
SNAPSHOTS = TESTS / "snapshots"
REF_DATE = date(2026, 10, 23)
CASES = sorted(p.stem for p in FIXTURES.glob("hkd_*.json"))
UPDATE = os.environ.get("LAC_UPDATE_SNAPSHOTS") == "1"


def run_case(name: str, ref_date: date = REF_DATE, cic_max_age: int = 30) -> dict[str, str]:
    """Chạy graph + validate như CLI, trả nội dung từng file output."""
    data = load(FIXTURES / f"{name}.json")
    cg = CaseGraph(data)
    G = cg.build()
    try:
        gj = nx.node_link_data(G, edges="edges")
    except TypeError:  # networkx < 3.4
        gj = nx.node_link_data(G)
    v = Validator(data, ref_date, cic_max_age).run()
    return {
        "llm_context.md": cg.render(),
        "graph.json": json.dumps(jsonable(gj), ensure_ascii=False, indent=1),
        "facts.json": json.dumps(v.facts_json(), ensure_ascii=False, indent=1),
        "discrepancies.json": json.dumps(jsonable(v.disc), ensure_ascii=False, indent=1),
        "discrepancies.md": v.disc_md(),
        "branch2_context.md": v.branch2_context(),
    }


@pytest.fixture
def validator():
    def make(name: str, **kw):
        return Validator(load(FIXTURES / f"{name}.json"), kw.pop("ref_date", REF_DATE), kw.pop("cic_max_age", 30)).run()
    return make
