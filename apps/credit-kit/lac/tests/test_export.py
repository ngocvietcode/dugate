import json
from pathlib import Path

import jsonschema
import pytest

from conftest import CASES, FIXTURES, REF_DATE
from lac.export import build_lac, dumps
from lac.graph import load

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "lac.schema.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", CASES)
def test_lac_json_matches_schema(name):
    lac = build_lac(load(FIXTURES / f"{name}.json"), REF_DATE)
    jsonschema.validate(json.loads(dumps(lac)), SCHEMA, format_checker=jsonschema.FormatChecker())


@pytest.mark.parametrize("name", CASES)
def test_lac_json_stable_bytes(name):
    a = dumps(build_lac(load(FIXTURES / f"{name}.json"), REF_DATE))
    b = dumps(build_lac(load(FIXTURES / f"{name}.json"), REF_DATE))
    assert a == b


def test_references_resolve():
    lac = build_lac(load(FIXTURES / "hkd_forms_plan_role.json"), REF_DATE)
    fids = {f["id"] for f in lac["facts"]}
    xids = {x["id"] for x in lac["discrepancies"]}
    for f in lac["facts"]:
        for fl in f["flags"]:
            assert fl.split(":")[0] in xids
    for x in lac["discrepancies"]:
        for fid in x["fields"]:
            if fid.startswith("F"):
                assert fid in fids
    ents = {e["id"] for e in lac["entities"]} | {d["id"] for d in lac["documents"]} | {"CASE"}
    for l in lac["links"]:
        assert l["source"] in ents and l["target"] in ents


def test_config_recorded():
    lac = build_lac(load(FIXTURES / "hkd_baseline.json"), REF_DATE)
    assert lac["case"]["config"] == {"product": "pp-hkd-secured", "version": "0.1.0", "status": "DRAFT"}
    assert lac["case"]["ref_date"] == "2026-10-23"


def test_schema_rejects_unknown_class():
    lac = json.loads(dumps(build_lac(load(FIXTURES / "hkd_income_x12.json"), REF_DATE)))
    lac["discrepancies"][0]["class"] = "Z"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(lac, SCHEMA)
