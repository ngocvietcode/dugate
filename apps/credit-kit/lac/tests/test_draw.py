import json

import pytest

from conftest import run_case

pytest.importorskip("matplotlib")
from lac.draw import draw  # noqa: E402


def test_draw_png(tmp_path):
    g = tmp_path / "graph.json"
    g.write_text(run_case("hkd_baseline")["graph.json"], encoding="utf-8")
    out = tmp_path / "graph.png"
    draw(g, out)
    assert out.stat().st_size > 10_000
    assert json.loads(g.read_text(encoding="utf-8"))["nodes"]
