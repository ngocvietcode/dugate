"""Activity lacBuild chạy như Temporal activity (ActivityEnvironment, không cần server)."""
import json

import pytest

pytest.importorskip("temporalio")
from temporalio.exceptions import ApplicationError  # noqa: E402
from temporalio.testing import ActivityEnvironment  # noqa: E402

from conftest import FIXTURES  # noqa: E402
from lac.worker import lac_build  # noqa: E402


def params(**kw):
    p = {"case": json.loads((FIXTURES / "hkd_cic_spouse_stale.json").read_text(encoding="utf-8")),
         "refDate": "2026-10-23", "config": "pp-hkd-secured@0.1.0"}
    p.update(kw)
    return p


def test_builds_lac():
    lac = ActivityEnvironment().run(lac_build, params())
    assert lac["schema"] == "lac" and lac["case"]["phase1"]["status"] == "INCOMPLETE"


def test_bad_input_is_non_retryable():
    with pytest.raises(ApplicationError) as e:
        ActivityEnvironment().run(lac_build, params(case={"case": {}}))
    assert e.value.non_retryable and e.value.type == "InputError"


def test_unknown_config_is_non_retryable():
    with pytest.raises(ApplicationError) as e:
        ActivityEnvironment().run(lac_build, params(config="pp-hkd-secured@9.9.9"))
    assert e.value.non_retryable


def test_require_approved_rejects_draft():
    with pytest.raises(ApplicationError) as e:
        ActivityEnvironment().run(lac_build, params(requireApproved=True))
    assert e.value.type == "ConfigNotApproved"
