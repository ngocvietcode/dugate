import json

import pytest

from conftest import CASES, FIXTURES
from lac.adapters.du_integration_v5 import InputError, to_lac_input


@pytest.mark.parametrize("name", CASES)
def test_fixtures_are_valid_du_v5(name):
    raw = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    assert to_lac_input(raw) is raw


def test_unwraps_result_envelope():
    raw = json.loads((FIXTURES / "hkd_baseline.json").read_text(encoding="utf-8"))
    assert to_lac_input({"result": {"extracted_data": raw}}) == raw


def test_missing_documents_rejected():
    with pytest.raises(InputError, match="documents"):
        to_lac_input({"case": {"id": "x"}})


def test_bad_field_path_rejected():
    raw = json.loads((FIXTURES / "hkd_baseline.json").read_text(encoding="utf-8"))
    raw["documents"]["records"][0]["fields"][0]["path"] = "legal_info..x"
    with pytest.raises(InputError, match="records/0/fields/0/path"):
        to_lac_input(raw)


def test_bad_status_rejected():
    raw = json.loads((FIXTURES / "hkd_baseline.json").read_text(encoding="utf-8"))
    raw["documents"]["records"][0]["fields"][0]["status"] = "MAYBE"
    with pytest.raises(InputError):
        to_lac_input(raw)
