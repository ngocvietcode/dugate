import json
import shutil
import subprocess
import sys
from pathlib import Path

from conftest import FIXTURES

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "measure.py"


def test_measure_on_fixtures(tmp_path):
    for n in ("hkd_baseline", "hkd_cic_spouse_stale"):
        shutil.copy(FIXTURES / f"{n}.json", tmp_path / f"{n}.json")
    (tmp_path / "hkd_cic_spouse_stale.labels.json").write_text(json.dumps({
        "risk_signals": ["R-CIC-SUBJECT", "R-CIC-AGE", "R-INCOME"],
        "rejected": ["R-X-PLAN-COGS"],
        "k1": {"P1.national_id": "001192012345", "L1.loan_info.requested_amount": 800000000},
        "phase1": "INCOMPLETE"}), encoding="utf-8")
    r = subprocess.run([sys.executable, str(SCRIPT), str(tmp_path), "--ref-date", "2026-10-23"],
                       capture_output=True, text=True, check=True)
    out = r.stdout
    assert "Đo LAC trên 2 hồ sơ (1 có nhãn)" in out
    assert "| Tỷ lệ bắt được dấu hiệu rủi ro | 66.7% |" in out
    assert "| Sửa sai thông tin K1 (mục tiêu 0) | 0 / 2 |" in out
    assert "| Cổng GĐ1 đúng | 100.0% |" in out
    assert "TRẦN" not in out and "012345678" not in out  # không in dữ liệu người
