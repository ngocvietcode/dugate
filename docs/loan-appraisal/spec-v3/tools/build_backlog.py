#!/usr/bin/env python3
"""Sinh BACKLOG.md từ các task card trong spec-v3 (không gõ tay).

Đọc mọi `### T-XXX-nn — Tiêu đề` (kèm các dòng `- Depends:`, `- Files:`, `- Verify:`)
và các dòng bảng `| T-DOC-nn | ... |` của S2. Xếp theo lớp (topological waves).
Lỗi (thoát mã 1): ID trùng, phụ thuộc tới ID không tồn tại, vòng phụ thuộc.

Dùng: python tools/build_backlog.py [--check]
  --check  chỉ kiểm tra, không ghi file.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASK_RE = re.compile(r"^### (T-[A-Z0-9]+-\d+)\s+—\s+(.*)$", re.M)
ID_RE = re.compile(r"T-[A-Z0-9]+-\d+")
FINAL_GATE_WORDS = ("mọi task", "toàn bộ task", "các file spec")

# D-32 (2026-10-16): triển khai trên workflow `loan-appraisal` (v2, 8 stage) thay cho W1/W2.
# Task của phần W1/W2, giao diện `/loan-dossier`, S6 (so OCR ↔ SL) KHÔNG làm; vẫn giữ trong
# spec để tra cứu, liệt kê riêng cuối BACKLOG. Xem cross_cutting/v2_integration.md §1.
V2_NA_PREFIXES = ("T-S6-", "T-U1-", "T-U2-", "T-U3-", "T-U4-", "T-API-", "T-RUN-")
V2_NA_IDS = {"T-CON-03", "T-CON-04", "T-EDIT-01", "T-NAV-01", "T-SEC-02", "T-SEC-03", "T-SEC-04", "T-TEST-03"}


def not_applicable(tid: str) -> bool:
    return tid.startswith(V2_NA_PREFIXES) or tid in V2_NA_IDS


def md_files() -> list[Path]:
    files = [ROOT / "04_data_model.md"]
    for sub in ("stages", "ui", "cross_cutting"):
        files += sorted((ROOT / sub).glob("*.md"))
    return [f for f in files if f.exists()]


def field(block: str, name: str) -> str:
    m = re.search(rf"^- {name}:\s*(.*)$", block, re.M)
    return m.group(1).strip() if m else ""


def parse() -> tuple[dict, list[str]]:
    tasks: dict[str, dict] = {}
    errors: list[str] = []
    for f in md_files():
        text = re.sub(r"^```.*?^```", "", f.read_text(encoding="utf-8"), flags=re.S | re.M)
        rel = f.relative_to(ROOT).as_posix()
        heads = list(TASK_RE.finditer(text))
        for i, m in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            nxt = re.search(r"^## ", text[m.end():end], re.M)
            if nxt:
                end = m.end() + nxt.start()
            block = text[m.end():end]
            tid = m.group(1)
            if tid in tasks:
                errors.append(f"ID trùng: {tid} ({rel} và {tasks[tid]['file']})")
                continue
            dep_raw = field(block, "Depends")
            tasks[tid] = {
                "id": tid, "title": m.group(2).strip(), "file": rel,
                "dep_raw": dep_raw,
                "deps": ID_RE.findall(dep_raw),
                "final": any(w in dep_raw.lower() for w in FINAL_GATE_WORDS),
                "verify": field(block, "Verify"),
                "has_files": bool(field(block, "Files")) or tid == "T-SEC-05" or tid == "T-TEST-04",
            }
        # Bảng T-DOC-nn trong S2
        if rel.endswith("S2_extract_evidence.md"):
            for row in re.finditer(r"^\| (T-DOC-\d+) \| `([a-z_]+)` \|", text, re.M):
                tid, key = row.group(1), row.group(2)
                if tid in tasks:
                    errors.append(f"ID trùng: {tid}")
                    continue
                tasks[tid] = {
                    "id": tid, "title": f"Schema {key}", "file": rel, "dep_raw": "T-S2-02",
                    "deps": ["T-S2-02"], "final": False,
                    "verify": f"npx jest tests/loan-dossier/s2-schema-{key}.test.ts",
                    "has_files": True,
                }
    return tasks, errors


def waves(tasks: dict) -> tuple[list[list[str]], list[str]]:
    errors: list[str] = []
    for t in tasks.values():
        for d in t["deps"]:
            if d not in tasks:
                errors.append(f"{t['id']} phụ thuộc {d} nhưng {d} không được định nghĩa ({t['file']})")
    if errors:
        return [], errors
    for t in tasks.values():
        if not not_applicable(t["id"]):
            for d in t["deps"]:
                if not_applicable(d):
                    errors.append(f"{t['id']} phụ thuộc {d} nhưng {d} không áp dụng trên nền v2 (D-32)")
    if errors:
        return [], errors
    regular = {k: v for k, v in tasks.items() if not v["final"] and not not_applicable(k)}
    done: set[str] = set()
    out: list[list[str]] = []
    remaining = set(regular)
    while remaining:
        # Phụ thuộc vào task "cổng cuối" không hợp lệ
        ready = sorted(
            k for k in remaining
            if all((d in done) for d in regular[k]["deps"] if d in regular)
            and all(d in regular for d in regular[k]["deps"])
        )
        if not ready:
            errors.append("Vòng phụ thuộc hoặc phụ thuộc vào task cổng cuối: " + ", ".join(sorted(remaining)))
            return out, errors
        out.append(ready)
        done.update(ready)
        remaining.difference_update(ready)
    return out, errors


def render(tasks: dict, wv: list[list[str]]) -> str:
    final = sorted(k for k, v in tasks.items() if v["final"] and not not_applicable(k))
    na = sorted(k for k in tasks if not_applicable(k))
    active = len(tasks) - len(na)
    lines = [
        "# BACKLOG",
        "",
        "> **File sinh tự động** bởi `tools/build_backlog.py` từ các task card. Không sửa tay; sửa task card rồi chạy lại.",
        "> Theo dõi tiến độ ở `PLAN.md` (milestone) và `IMPLEMENT.md` (nhật ký); file này không lưu trạng thái.",
        "> Nền v2 (D-32): triển khai trong workflow `loan-appraisal` 8 stage — xem `cross_cutting/v2_integration.md`.",
        "",
        f"Tổng: **{active} task cần làm**, {len(wv)} lớp song song + {len(final)} cổng cuối; {len(na)} task không áp dụng trên nền v2 (cuối file).",
        "",
        "Cách dùng: chọn task ở lớp thấp nhất chưa xong; mọi `Depends` đã xong mới làm. Trong cùng một lớp, các task độc lập — có thể giao song song.",
        "",
    ]
    for i, ids in enumerate(wv, 1):
        lines += [f"## Lớp {i} ({len(ids)} task)", "", "| Task | Tiêu đề | Phụ thuộc | Spec | Verify |", "|---|---|---|---|---|"]
        for k in ids:
            t = tasks[k]
            deps = ", ".join(t["deps"]) or "—"
            v = t["verify"].strip("`") if t["verify"] else "—"
            lines.append(f"| {k} | {t['title']} | {deps} | `{t['file']}` | `{v}` |")
        lines.append("")
    lines += ["## Cổng cuối (sau mọi task code)", "", "| Task | Tiêu đề | Spec | Verify |", "|---|---|---|---|"]
    for k in final:
        t = tasks[k]
        v = t["verify"].strip("`") if t["verify"] else "—"
        lines.append(f"| {k} | {t['title']} | `{t['file']}` | `{v}` |")
    lines.append("")
    lines += ["## Không áp dụng trên nền v2 (D-32)", "",
              "Giữ trong spec để tra cứu; không làm, không tính vào lớp.", "",
              "| Task | Tiêu đề | Spec |", "|---|---|---|"]
    for k in na:
        t = tasks[k]
        lines.append(f"| {k} | {t['title']} | `{t['file']}` |")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    # Console Windows (cp1258…) không mã hóa được mọi ký tự tiếng Việt dựng sẵn → thay thế thay vì crash.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    check_only = "--check" in sys.argv
    tasks, errors = parse()
    wv, e2 = waves(tasks) if not errors else ([], [])
    errors += e2
    if errors:
        print("LỖI BACKLOG:")
        for e in errors:
            print(" -", e)
        return 1
    missing_verify = [k for k, v in tasks.items() if not v["verify"]]
    if missing_verify:
        print("LỖI: task thiếu Verify:", ", ".join(sorted(missing_verify)))
        return 1
    if not check_only:
        (ROOT / "BACKLOG.md").write_text(render(tasks, wv), encoding="utf-8")
        print(f"wrote BACKLOG.md: {len(tasks)} task, {len(wv)} lớp")
    else:
        print(f"OK: {len(tasks)} task, {len(wv)} lớp, không vòng, mọi Depends tồn tại, mọi task có Verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
