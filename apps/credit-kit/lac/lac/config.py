"""Cấu hình LAC có version theo sản phẩm: apps/credit-kit/config/<product>/<version>/*.yaml.

Hằng số quy tắc trước đây nằm trong validate.py / graph.py (PoC) được chuyển ra đây nguyên giá trị.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from lac.graph import norm_text

CONFIG_ROOT = Path(os.environ.get("LAC_CONFIG_ROOT", Path(__file__).resolve().parents[2] / "config"))
DEFAULT_PRODUCT = "pp-hkd-secured"
DEFAULT_VERSION = "0.1.0"
STATUSES = ("DRAFT", "APPROVED")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class IdentityScoring:
    scores: dict
    min_score: int
    min_margin: int
    high_confidence: int

    def w(self, key: str, kind: str = "match") -> int:
        return self.scores.get(key, {}).get(kind, 0)


@dataclass(frozen=True)
class Config:
    product: str
    version: str
    status: str
    default_tier: float
    source_groups: dict
    party_field_groups: dict
    tiers: dict
    income_attrs: frozenset
    business_synonyms: dict
    temporal_attrs: frozenset
    stale_days: int
    k1: frozenset
    k1_prefixes: tuple
    k2: frozenset
    severity_order: tuple
    severity_base: dict
    cic_max_age_days: int
    fin_tolerance: float
    identity: IdentityScoring
    self_declared: frozenset
    loan_docs: frozenset
    role_canon: dict
    province_codes: dict
    abbrev: tuple
    province_by_name: dict = field(default_factory=dict)
    checklist: tuple = ()
    validity: dict = field(default_factory=dict)
    signal_params: dict = field(default_factory=dict)
    source_types: dict = field(default_factory=dict)

    @property
    def ref(self) -> str:
        return f"{self.product}@{self.version}"


def _need(d: dict, key: str, typ, src: str):
    if key not in d:
        raise ConfigError(f"{src}: thiếu khoá '{key}'")
    if not isinstance(d[key], typ):
        raise ConfigError(f"{src}: '{key}' phải là {typ}")
    return d[key]


@lru_cache(maxsize=None)
def load_config(product: str = DEFAULT_PRODUCT, version: str = DEFAULT_VERSION, root: str | None = None) -> Config:
    base = Path(root) if root else CONFIG_ROOT
    d = base / product / version
    if not (d / "manifest.yaml").exists():
        raise ConfigError(f"không có cấu hình {product}@{version} tại {d}")
    man = yaml.safe_load((d / "manifest.yaml").read_text(encoding="utf-8"))
    merged: dict = {}
    for fn in _need(man, "files", list, "manifest.yaml"):
        part = yaml.safe_load((d / fn).read_text(encoding="utf-8")) or {}
        dup = set(part) & set(merged)
        if dup:
            raise ConfigError(f"{fn}: khoá trùng {sorted(dup)}")
        merged.update(part)
    status = _need(man, "status", str, "manifest.yaml")
    if status not in STATUSES:
        raise ConfigError(f"manifest.yaml: status phải thuộc {STATUSES}")
    if str(man.get("version")) != version:
        raise ConfigError(f"manifest.yaml: version {man.get('version')} khác thư mục {version}")
    m = merged
    income = frozenset(_need(m, "income_attrs", list, "authority"))
    ident = _need(m, "scores", dict, "identity")
    abbrev = tuple((re.compile(p), r) for p, r in _need(m, "abbrev", list, "abbrev"))
    provinces = {str(k): v for k, v in _need(m, "province_codes", dict, "provinces").items()}
    for k in provinces:
        if not re.fullmatch(r"\d{3}", k):
            raise ConfigError(f"provinces: mã tỉnh '{k}' không phải 3 chữ số")
    sev_order = tuple(_need(m, "severity_order", list, "criticality"))
    sev_base = _need(m, "severity_base", dict, "criticality")
    for cls, row in sev_base.items():
        for k, s in row.items():
            if s not in sev_order:
                raise ConfigError(f"criticality: severity_base.{cls}.{k}={s} không thuộc severity_order")
    return Config(
        product=product, version=version, status=status,
        default_tier=m.get("default_tier", 3),
        source_groups=_need(m, "source_groups", dict, "authority"),
        party_field_groups=_need(m, "party_field_groups", dict, "authority"),
        tiers=_need(m, "tiers", dict, "authority"),
        income_attrs=income,
        business_synonyms=m.get("business_synonyms", {}),
        temporal_attrs=frozenset(_need(m, "temporal_attrs", list, "temporal")),
        stale_days=_need(m, "stale_days", int, "temporal"),
        k1=frozenset(_need(m, "k1", list, "criticality")),
        k1_prefixes=tuple(m.get("k1_prefixes", [])),
        k2=frozenset(_need(m, "k2", list, "criticality")) | income,
        severity_order=sev_order, severity_base=sev_base,
        cic_max_age_days=_need(m, "cic_max_age_days", int, "params"),
        fin_tolerance=float(_need(m, "fin_tolerance", (int, float), "params")),
        identity=IdentityScoring(scores=ident, min_score=_need(m, "min_score", int, "identity"),
                                 min_margin=_need(m, "min_margin", int, "identity"),
                                 high_confidence=_need(m, "high_confidence", int, "identity")),
        self_declared=frozenset(_need(m, "self_declared", list, "documents")),
        loan_docs=frozenset(_need(m, "loan_docs", list, "documents")),
        role_canon=_need(m, "role_canon", dict, "documents"),
        province_codes=provinces, abbrev=abbrev,
        province_by_name={norm_text(v): k for k, v in provinces.items()},
        checklist=tuple(_checklist(m.get("checklist", []))),
        validity=_validity(m.get("validity", {}), _need(m, "cic_max_age_days", int, "params")),
        signal_params={k: float(_need(m, k, (int, float), "params"))
                       for k in ("ltv_cap", "ltv_margin", "plan_cogs_max", "loan_revenue_max")},
        source_types=m.get("source_types", {}),
    )


SUBJECTS = ("borrower", "spouse", "collateral", "none")


def _checklist(items: list) -> list[dict]:
    seen = set()
    for it in items:
        for k in ("key", "group", "required", "accept", "subject"):
            if k not in it:
                raise ConfigError(f"checklist: mục {it.get('key', '?')} thiếu '{k}'")
        if it["subject"] not in SUBJECTS:
            raise ConfigError(f"checklist: {it['key']}.subject phải thuộc {SUBJECTS}")
        if it["key"] in seen:
            raise ConfigError(f"checklist: trùng key {it['key']}")
        seen.add(it["key"])
    return items


def _validity(v: dict, cic_max_age: int) -> dict:
    out = {}
    for doc_type, rule in v.items():
        r = dict(rule)
        if r.get("max_age_days") == "params.cic_max_age_days":
            r["max_age_days"] = cic_max_age
        out[doc_type] = r
    return out
