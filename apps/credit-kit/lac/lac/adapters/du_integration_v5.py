"""Adapter đầu vào: đầu ra DU `dugate.loan-appraisal.integration` 5.0 -> dict mà lac.graph/lac.validate đọc.

Định dạng này đã là định dạng PoC đọc trực tiếp; adapter chỉ bóc lớp bọc {result: {extracted_data}} và kiểm
cấu trúc theo contracts/du-integration-v5.input.schema.json để lỗi đầu vào hiện ra rõ ràng thay vì KeyError
giữa chừng. Adapter cho contract đầu ra của Core viết sau khi chốt LAC-3.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import jsonschema

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "contracts" / "du-integration-v5.input.schema.json"


class InputError(ValueError):
    pass


@lru_cache(maxsize=1)
def _validator():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def unwrap(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise InputError("đầu vào phải là object JSON")
    return raw.get("result", {}).get("extracted_data", raw) if "result" in raw else raw


def to_lac_input(raw: dict) -> dict:
    data = unwrap(raw)
    errs = sorted(_validator().iter_errors(data), key=lambda e: list(e.absolute_path))
    if errs:
        lines = [f"{'/'.join(map(str, e.absolute_path)) or '<gốc>'}: {e.message}" for e in errs[:10]]
        raise InputError("đầu vào DU v5 không hợp lệ:\n  " + "\n  ".join(lines))
    return data
