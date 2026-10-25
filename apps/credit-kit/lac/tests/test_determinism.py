"""NFR-1: cùng đầu vào + cùng cấu hình -> cùng output, kể cả giữa các tiến trình có hash seed khác nhau."""
import hashlib
import json
import os
import subprocess
import sys

import pytest

from conftest import CASES, TESTS, run_case

PROBE = """
import hashlib, json, sys
sys.path.insert(0, sys.argv[1])
from conftest import run_case
out = run_case(sys.argv[2])
print(json.dumps({k: hashlib.sha256(v.encode()).hexdigest() for k, v in out.items()}, sort_keys=True))
"""


@pytest.mark.parametrize("name", CASES)
def test_same_process_twice(name):
    assert run_case(name) == run_case(name)


@pytest.mark.parametrize("name", CASES)
def test_across_hash_seeds(name):
    digests = set()
    for seed in ("0", "1", "12345"):
        env = {**os.environ, "PYTHONHASHSEED": seed}
        r = subprocess.run([sys.executable, "-c", PROBE, str(TESTS), name], capture_output=True, text=True,
                           env=env, check=True)
        digests.add(r.stdout.strip())
    assert len(digests) == 1, f"{name}: output phụ thuộc PYTHONHASHSEED"
