"""contracts/examples/*.lac.json là contract fixture cho App TypeScript (Zod). Phải khớp output hiện tại.

Cập nhật: LAC_UPDATE_SNAPSHOTS=1 pytest tests/test_contract_examples.py
"""
import pytest

from conftest import FIXTURES, REF_DATE, UPDATE
from lac.export import build_lac, dumps
from lac.graph import load

EX = FIXTURES.parents[2] / "contracts" / "examples"
CASES = ["hkd_forms_plan_role", "hkd_income_x12", "hkd_cic_spouse_stale"]


@pytest.mark.parametrize("name", CASES)
def test_example_up_to_date(name):
    text = dumps(build_lac(load(FIXTURES / f"{name}.json"), REF_DATE))
    p = EX / f"{name}.lac.json"
    if UPDATE:
        EX.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        pytest.skip("đã cập nhật")
    assert p.read_text(encoding="utf-8") == text
