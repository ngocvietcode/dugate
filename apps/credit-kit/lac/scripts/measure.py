#!/usr/bin/env python3
"""Đo LAC trên một thư mục hồ sơ đã thẩm định (LAC §7.2). Chạy ở môi trường được phép xử lý dữ liệu thật (LAC-4).

  python scripts/measure.py /duong/dan/ho-so --ref-date 2026-10-23 [--out /duong/dan/ket-qua.md]

Mỗi hồ sơ `<x>.json` (đầu ra DU v5). Nhãn chuyên viên tuỳ chọn ở `<x>.labels.json`:
  {
    "risk_signals": ["R-CIC-SUBJECT", "R-INCOME", "R-X-PLAN-COGS"],   # dấu hiệu chuyên viên nêu (mã quy tắc)
    "rejected":     ["R-CROSS"],                                      # cảnh báo chuyên viên bác bỏ
    "mentions":     {"D9#0": "P2"},                                   # lần nhắc -> người đúng
    "k1":           {"P1.national_id": "...", "L1.loan_info.requested_amount": 1670000000},
    "phase1":       "INCOMPLETE"
  }
Script không in giá trị trường của người; chỉ in mã hồ sơ và số đếm. Token là ước tính ~3 ký tự/token —
thay bằng tokenizer của model AIHub khi có (tham số --chars-per-token).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lac.export import build_lac  # noqa: E402
from lac.graph import load, norm_id, norm_text  # noqa: E402


def _same(a, b) -> bool:
    if isinstance(a, (int, float)) or isinstance(b, (int, float)):
        return a == b
    return norm_id(a) == norm_id(b) if any(ch.isdigit() for ch in str(a)) else norm_text(a) == norm_text(b)


def measure_case(path: Path, ref: date | None, cpt: float) -> dict:
    t0 = time.perf_counter()
    lac = build_lac(load(path), ref)
    ms = (time.perf_counter() - t0) * 1000
    raw = path.read_text(encoding="utf-8")
    produced = {x["rule"] for x in lac["discrepancies"] if x["class"] != "N"} | {t["rule"] for t in lac["signals"]}
    r = {"case": lac["case"]["id"], "ms": round(ms, 1), "raw_tokens": round(len(raw) / cpt),
         "branch2_tokens": round(len(lac["branch2"]["markdown"]) / cpt), **lac["stats"],
         "phase1": lac["case"]["phase1"]["status"]}
    lab_p = path.with_name(path.stem + ".labels.json")
    if not lab_p.exists():
        return r
    lab = json.loads(lab_p.read_text(encoding="utf-8"))
    exp = set(lab.get("risk_signals", []))
    r["risk_expected"], r["risk_caught"] = len(exp), len(exp & produced)
    rej = set(lab.get("rejected", []))
    r["alerts"], r["alerts_rejected"] = len(produced), len(produced & rej)
    by = {f"{m['doc']}#{m['idx']}": m for m in lac["mentions"]}
    for conf in ("cao", "trung bình"):
        keys = [k for k, p in lab.get("mentions", {}).items() if k in by and by[k]["confidence"] == conf]
        r[f"mentions_{conf}"] = len(keys)
        r[f"mentions_{conf}_ok"] = sum(by[k]["party"] == lab["mentions"][k] for k in keys)
    facts = {f"{f['entity']}.{f['field']}": f for f in lac["facts"]}
    k1 = lab.get("k1", {})
    r["k1_checked"] = sum(1 for k in k1 if k in facts)
    r["k1_wrong"] = sum(1 for k, v in k1.items() if k in facts and facts[k]["value"] is not None
                        and not _same(facts[k]["value"], v))
    if "phase1" in lab:
        r["phase1_ok"] = int(lab["phase1"] == r["phase1"])
    return r


def summarize(rows: list[dict]) -> str:
    def tot(k):
        return sum(r.get(k, 0) for r in rows)

    def pct(a, b):
        return f"{a / b:.1%}" if b else "—"
    labeled = [r for r in rows if "risk_expected" in r]
    L = [f"# Đo LAC trên {len(rows)} hồ sơ ({len(labeled)} có nhãn)", "",
         "| Chỉ số | Giá trị |", "|---|---|",
         f"| Tỷ lệ bắt được dấu hiệu rủi ro | {pct(tot('risk_caught'), tot('risk_expected'))} |",
         f"| Tỷ lệ cảnh báo bị bác bỏ | {pct(tot('alerts_rejected'), tot('alerts'))} |",
         f"| Gán người đúng — mức cao | {pct(tot('mentions_cao_ok'), tot('mentions_cao'))} |",
         f"| Gán người đúng — mức trung bình | {pct(tot('mentions_trung bình_ok'), tot('mentions_trung bình'))} |",
         f"| Sửa sai thông tin K1 (mục tiêu 0) | {tot('k1_wrong')} / {tot('k1_checked')} |",
         f"| Cổng GĐ1 đúng | {pct(tot('phase1_ok'), sum(1 for r in labeled if 'phase1_ok' in r))} |",
         f"| Token JSON DU → bản trích nhánh 2 (ước tính) | {tot('raw_tokens'):,} → {tot('branch2_tokens'):,} "
         f"({pct(tot('branch2_tokens'), tot('raw_tokens'))}) |",
         f"| Thời gian lớp LAC trung bình | {tot('ms') / len(rows):.1f} ms |" if rows else "",
         "", "| Hồ sơ | GĐ1 | Sai lệch | S1/S2/S3 | Nhánh 2 | Token DU→nhánh 2 |", "|---|---|---|---|---|---|"]
    for r in rows:
        s = r["by_severity"]
        L.append(f"| {r['case']} | {r['phase1']} | {r['discrepancies']} | {s.get('S1', 0)}/{s.get('S2', 0)}/{s.get('S3', 0)} "
                 f"| {r['to_branch2']} | {r['raw_tokens']:,}→{r['branch2_tokens']:,} |")
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path)
    ap.add_argument("--ref-date", type=date.fromisoformat, default=None)
    ap.add_argument("--chars-per-token", type=float, default=3.0)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    files = sorted(p for p in a.folder.glob("*.json") if not p.name.endswith(".labels.json"))
    rows = []
    for p in files:
        try:
            rows.append(measure_case(p, a.ref_date, a.chars_per_token))
        except Exception as e:  # một hồ sơ lỗi không dừng cả lô; chỉ in tên file và loại lỗi
            print(f"bỏ qua {p.name}: {type(e).__name__}", file=sys.stderr)
    text = summarize(rows)
    if a.out:
        a.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
