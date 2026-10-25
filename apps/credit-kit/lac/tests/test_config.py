import shutil

import pytest
import yaml

from conftest import FIXTURES
from lac.config import CONFIG_ROOT, DEFAULT_PRODUCT, DEFAULT_VERSION, ConfigError, load_config
from lac.graph import load
from lac.validate import Validator
from conftest import REF_DATE


@pytest.fixture
def cfg_copy(tmp_path):
    """Bản sao cấu hình mặc định để sửa trong test; trả hàm (sửa file) -> Config."""
    dst = tmp_path / DEFAULT_PRODUCT / DEFAULT_VERSION
    shutil.copytree(CONFIG_ROOT / DEFAULT_PRODUCT / DEFAULT_VERSION, dst)

    def edit(fn, **changes):
        p = dst / fn
        d = yaml.safe_load(p.read_text(encoding="utf-8"))
        d.update(changes)
        p.write_text(yaml.safe_dump(d, allow_unicode=True), encoding="utf-8")
        load_config.cache_clear()
        return load_config(DEFAULT_PRODUCT, DEFAULT_VERSION, str(tmp_path))
    yield edit
    load_config.cache_clear()


def rules(v):
    return [x["rule"] for x in v.disc]


def test_default_config_loads():
    c = load_config()
    assert c.ref == "pp-hkd-secured@0.1.0"
    assert c.status == "DRAFT"
    assert c.cic_max_age_days == 30
    assert len(c.province_codes) == 63
    assert "net_profit_annual" in c.k2  # income_attrs cộng vào K2


def test_cic_max_age_from_config(cfg_copy):
    data = load(FIXTURES / "hkd_cic_spouse_stale.json")
    assert "R-CIC-AGE" in rules(Validator(data, REF_DATE).run())
    cfg = cfg_copy("params.yaml", cic_max_age_days=120)
    assert "R-CIC-AGE" not in rules(Validator(data, REF_DATE, config=cfg).run())


def test_cli_override_beats_config(cfg_copy):
    data = load(FIXTURES / "hkd_cic_spouse_stale.json")
    cfg = cfg_copy("params.yaml", cic_max_age_days=120)
    assert "R-CIC-AGE" in rules(Validator(data, REF_DATE, cic_max_age=30, config=cfg).run())


def test_identity_threshold_from_config(cfg_copy):
    data = load(FIXTURES / "hkd_baseline.json")
    cfg = cfg_copy("identity.yaml", min_score=99)
    v = Validator(data, REF_DATE, config=cfg).run()
    assert v.cg.unresolved > 0  # không đủ điểm -> người chưa xác định U#, không đoán


def test_fin_tolerance_from_config(cfg_copy):
    data = load(FIXTURES / "hkd_income_x12.json")
    assert "R-INCOME" in rules(Validator(data, REF_DATE).run())
    cfg = cfg_copy("params.yaml", fin_tolerance=20.0)
    assert "R-INCOME" not in rules(Validator(data, REF_DATE, config=cfg).run())


def test_bad_status_rejected(cfg_copy):
    with pytest.raises(ConfigError, match="status"):
        cfg_copy("manifest.yaml", status="LIVE")


def test_bad_severity_rejected(cfg_copy):
    with pytest.raises(ConfigError, match="severity_base"):
        cfg_copy("criticality.yaml", severity_base={"A": {"K1": "S9", "K2": "S3", "K3": "S3"}})


def test_unknown_version_rejected():
    with pytest.raises(ConfigError):
        load_config(DEFAULT_PRODUCT, "9.9.9")
