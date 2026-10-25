"""Fixture chỉ là dữ liệu giả lập do make_synthetic.py sinh ra (spec 002 NFR-6)."""
import re
import subprocess
import sys

from conftest import FIXTURES

sys.path.insert(0, str(FIXTURES))
import make_synthetic  # noqa: E402


def test_fixtures_match_generator():
    r = subprocess.run([sys.executable, str(FIXTURES / "make_synthetic.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_only_declared_fake_numbers():
    """Chuỗi số 9–13 chữ số (số định danh, SĐT, mã) phải thuộc tập giá trị giả đã khai báo;
    ngoại lệ duy nhất là số tiền (bội số của 1.000.000)."""
    allowed = {re.sub(r"\D", "", x) for x in make_synthetic.FAKE_NUMBERS}
    for p in FIXTURES.glob("hkd_*.json"):
        for m in re.finditer(r"(?<![\d-])\d{9,13}(?![\d-])", p.read_text(encoding="utf-8")):
            n = m.group()
            assert n in allowed or int(n) % 1_000_000 == 0, f"{p.name}: số không khai báo {n}"
