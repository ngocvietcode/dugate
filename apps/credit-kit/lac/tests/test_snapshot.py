"""Khoá hành vi PoC: output của từng fixture phải khớp snapshot đã duyệt.

Cập nhật snapshot (chỉ khi thay đổi hành vi có chủ đích, kèm giải thích trong commit):
    LAC_UPDATE_SNAPSHOTS=1 pytest tests/test_snapshot.py
"""
import pytest

from conftest import CASES, SNAPSHOTS, UPDATE, run_case


@pytest.mark.parametrize("name", CASES)
def test_snapshot(name):
    out = run_case(name)
    d = SNAPSHOTS / name
    if UPDATE:
        d.mkdir(parents=True, exist_ok=True)
        for fn, text in out.items():
            (d / fn).write_text(text, encoding="utf-8")
        pytest.skip("đã cập nhật snapshot")
    for fn, text in out.items():
        assert (d / fn).exists(), f"thiếu snapshot {name}/{fn} — chạy với LAC_UPDATE_SNAPSHOTS=1"
        assert text == (d / fn).read_text(encoding="utf-8"), f"{name}/{fn} khác snapshot"
