#!/usr/bin/env python3
"""Vẽ graph hồ sơ (graph.json do lac.graph xuất) thành ảnh PNG/SVG.

  python -m lac.draw graph.json -o graph.png
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import FancyArrowPatch, Patch

plt.rcParams["font.family"] = "DejaVu Sans"

COLUMN = {"document": 0, "party": 1, "asset": 2, "loan_request": 2, "business": 2,
          "funding_plan": 3, "institution": 3}
ORDER_IN_COL = {"asset": 0, "loan_request": 1, "business": 2, "funding_plan": 0, "institution": 1}
STYLE = {  # fill, border
    "document": ("#EEF1F5", "#7A8699"),
    "party": ("#FDE9D9", "#C8642A"),
    "loan_request": ("#E3EEFB", "#2F6DB5"),
    "asset": ("#E5F4EA", "#2E8B57"),
    "business": ("#F3E8FA", "#8A4FB3"),
    "funding_plan": ("#FFF6D6", "#B8901C"),
    "institution": ("#F2F2F2", "#8C8C8C"),
}
KIND_VI = {"document": "Chứng từ", "party": "Người", "loan_request": "Khoản vay đề nghị",
           "asset": "Tài sản", "business": "Hộ kinh doanh", "funding_plan": "Phương án vốn",
           "institution": "TCTD tra cứu CIC"}
DOC_VI = {"id_card": "CCCD / Căn cước", "qr_code_info": "QR CCCD", "vneid": "VNeID",
          "marriage_certificate": "Đăng ký kết hôn", "loan_application": "Giấy đề nghị vay",
          "purchase_list": "Bảng kê hàng hoá", "income_statement": "Bảng kê thu nhập",
          "land_use_certificate": "GCN QSDĐ", "cic": "Báo cáo CIC"}
REL_VI = {"SPOUSE": "vợ/chồng", "APPLIES_FOR": "đề nghị vay", "OWNS": "sở hữu",
          "OWNS_BUSINESS": "chủ HKD", "SUBMITS": "lập", "PARTICIPATES": "tham gia",
          "CIC_QUERIED_BY": "tra cứu CIC", "SECURED_BY": "bảo đảm bằng",
          "FOR_BUSINESS": "cho HKD", "USE_OF_FUNDS": "sử dụng vốn", "EVIDENCES": "chứng minh"}
REL_COLOR = {"SPOUSE": "#C8642A", "APPLIES_FOR": "#2F6DB5", "PARTICIPATES": "#2F6DB5",
             "OWNS": "#2E8B57", "SECURED_BY": "#2E8B57", "EVIDENCES": "#2E8B57",
             "OWNS_BUSINESS": "#8A4FB3", "FOR_BUSINESS": "#8A4FB3",
             "SUBMITS": "#B8901C", "USE_OF_FUNDS": "#B8901C", "CIC_QUERIED_BY": "#8C8C8C"}


def vnd(v):
    if not isinstance(v, (int, float)):
        return "?"
    if v >= 1e9:
        return f"{v / 1e9:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " tỷ"
    return f"{v / 1e6:.1f}".rstrip("0").rstrip(".").replace(".", ",") + " tr"


def obs_first(n, key):
    v = (n.get("obs") or {}).get(key)
    return v[0][0] if v else None


def label(n, edges_in):
    k, i = n["kind"], n["id"]
    if k == "document":
        sub = " · ".join(x for x in (n.get("issue_date"), n.get("number")) if x)
        return f"{i} · {DOC_VI.get(n['doc_type'], n['doc_type'])}" + (f"\n{sub}" if sub else "")
    if k == "party":
        roles = []
        for r in n.get("roles", []):
            if r[0] not in roles:
                roles.append(r[0])
        return f"{i} · {n.get('name') or 'chưa xác định'}\n" + ", ".join(roles)
    if k == "loan_request":
        a = n.get("attrs", {})
        return (f"{i} · Khoản vay đề nghị\n{vnd(a.get('loan_info.requested_amount'))} · "
                f"{a.get('loan_info.loan_term_months', '?')} tháng\n{a.get('loan_info.principal_repayment_method', '')}")
    if k == "asset":
        area = obs_first(n, "land_area_m2")
        val = n.get("case_value")
        return (f"{i} · GCN {n.get('certificate_number')}\n"
                + (f"{area:g} m²".replace(".", ",") if area else "")
                + (f" · {vnd(val)}*" if val else ""))
    if k == "business":
        rev = obs_first(n, "net_revenue_annual")
        prof = obs_first(n, "net_profit_annual")
        return (f"{i} · {n.get('name')}\n{obs_first(n, 'business_line') or ''}\n"
                f"DT {vnd(rev)}/năm · LN {vnd(prof)}/năm")
    if k == "funding_plan":
        return f"{i} · Phương án vốn\n{len(n.get('items', []))} mặt hàng · {vnd(n.get('total'))}"
    if k == "institution":
        cnt = sum(len(e.get("dates", [])) for e in edges_in)
        return f"{n.get('name')}\n{cnt} lượt tra cứu"
    return i


def layout(nodes, edges):
    cols = defaultdict(list)
    for n in nodes.values():
        if n["kind"] in COLUMN:
            cols[COLUMN[n["kind"]]].append(n["id"])
    nbr = defaultdict(set)
    for e in edges:
        nbr[e["source"]].add(e["target"])
        nbr[e["target"]].add(e["source"])
    H, pos = 10.0, {}
    col_x = {0: 0.0, 1: 4.6, 2: 9.6, 3: 14.4}

    def spread(ids, x, top=H, bottom=0.0):
        n = len(ids)
        for r, i in enumerate(ids):
            pos[i] = (x, top - (r + 0.5) * (top - bottom) / n)

    def bary(i):
        ys = [pos[j][1] for j in nbr[i] if j in pos]
        return sum(ys) / len(ys) if ys else H / 2

    docs = sorted(cols[0], key=lambda s: int(s[1:]) if s[1:].isdigit() else 0)
    spread(docs, col_x[0], top=H + 0.4, bottom=0.2)
    parties = sorted(cols[1], key=lambda i: -bary(i))
    spread(parties, col_x[1], top=H - 0.6, bottom=1.6)
    mid = sorted(cols[2], key=lambda i: ORDER_IN_COL.get(nodes[i]["kind"], 0))
    spread(mid, col_x[2], top=H + 0.2, bottom=1.4)
    for i in cols[3]:
        if nodes[i]["kind"] != "institution":
            pos[i] = (col_x[3], bary(i))
    inst = [i for i in cols[3] if nodes[i]["kind"] == "institution"]
    for k, i in enumerate(inst):  # hàng dưới cùng, ngay dưới người được tra cứu
        pos[i] = (3.4 + k * (12.4 - 3.4) / max(1, len(inst) - 1), -0.35)
    return pos


def draw(graph_path: Path, out: Path):
    g = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in g["nodes"]}
    edges = [e for e in g["edges"] if e["rel"] not in ("HAS_DOCUMENT", "EVIDENCES")]
    pos = layout(nodes, edges)
    case = nodes.get("CASE", {})

    fig, ax = plt.subplots(figsize=(19, 12.5), dpi=150)
    ax.set_xlim(-1.9, 16.4)
    ax.set_ylim(-1.4, 11.2)
    ax.axis("off")

    texts = {}
    in_edges = defaultdict(list)
    for e in edges:
        in_edges[e["target"]].append(e)
    for i, (x, y) in pos.items():
        n = nodes[i]
        fill, border = STYLE[n["kind"]]
        fs = 10.5 if n["kind"] in ("party", "loan_request") else 9
        weight = "bold" if n["kind"] == "party" else "normal"
        texts[i] = ax.text(x, y, label(n, in_edges[i]), ha="center", va="center", fontsize=fs,
                           fontweight=weight, zorder=3, linespacing=1.35,
                           bbox=dict(boxstyle="round,pad=0.55", fc=fill, ec=border, lw=1.6))
    fig.canvas.draw()

    # gộp cạnh trùng (cùng u, rel, v) để nhãn nguồn gom lại
    merged = {}
    for e in edges:
        key = (e["source"], e["rel"], e["target"])
        m = merged.setdefault(key, {**e, "src": list(e.get("src", []))})
        m["src"] = sorted(set(m["src"]) | set(e.get("src", [])))

    inv = ax.transData.inverted()
    boxes = []
    for t_ in texts.values():
        bb = t_.get_bbox_patch().get_window_extent()
        (bx0, by0), (bx1, by1) = inv.transform((bb.x0, bb.y0)), inv.transform((bb.x1, bb.y1))
        boxes.append((bx0 - 0.08, by0 - 0.08, bx1 + 0.08, by1 + 0.08))

    def inside(px, py, b):
        return b[0] <= px <= b[2] and b[1] <= py <= b[3]

    mention_labels = []
    cic_flag = {"done": False}
    for (u, rel, v), e in merged.items():
        if u not in texts or v not in texts:
            continue
        (x1, y1), (x2, y2) = pos[u], pos[v]
        same_col = abs(x1 - x2) < 0.01
        rad = 0.35 if same_col else 0.0
        if rel == "MENTIONS":
            conf = e.get("confidence")
            color = "#9AA3AF" if conf == "cao" else "#C8642A"
            ls = "-" if conf == "cao" else (0, (4, 3))
            lw = 1.0 if conf == "cao" else 1.6
        else:
            color, ls, lw = REL_COLOR.get(rel, "#555"), "-", 2.0
        arr = FancyArrowPatch(posA=(x1, y1), posB=(x2, y2), patchA=texts[u].get_bbox_patch(),
                              patchB=texts[v].get_bbox_patch(), arrowstyle="-|>", mutation_scale=13,
                              color=color, lw=lw, linestyle=ls, zorder=1,
                              connectionstyle=f"arc3,rad={rad}", shrinkA=2, shrinkB=2)
        ax.add_patch(arr)
        # nhãn cạnh
        if rel == "MENTIONS":
            # đặt nhãn ở giữa đoạn cạnh không bị ô node che
            vis = [k / 200 for k in range(201)
                   if not any(inside(x1 + (x2 - x1) * k / 200, y1 + (y2 - y1) * k / 200, b) for b in boxes)]
            t = vis[len(vis) // 2] if vis else 0.5
            txt = e.get("role") or ""
            if e.get("confidence") != "cao":
                txt += f" ({e['confidence']})"
            mention_labels.append([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, txt, color])
        else:
            if rel == "CIC_QUERIED_BY":
                if cic_flag["done"]:
                    continue
                cic_flag["done"] = True
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            if same_col:
                mx += 1.15
            txt = REL_VI.get(rel, rel)
            if e.get("src"):
                txt += f" [{','.join(e['src'])}]"
            ax.text(mx, my, txt, fontsize=8.2, color=color, ha="center", va="center", zorder=2,
                    fontweight="bold", bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.9))

    # nhãn vai trò: đẩy giãn theo chiều dọc khi chồng nhau
    for _ in range(30):
        moved = False
        for a in mention_labels:
            for b in mention_labels:
                if a is b:
                    continue
                if abs(a[0] - b[0]) < 1.1 and abs(a[1] - b[1]) < 0.26:
                    d = 0.06 if a[1] >= b[1] else -0.06
                    a[1] += d; b[1] -= d; moved = True
        if not moved:
            break
    for lx, ly, txt, color in mention_labels:
        ax.text(lx, ly, txt, fontsize=7.3, color=color, ha="center", va="center", zorder=4,
                bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.9))

    # tiêu đề cột
    for x, t in ((0.0, "Chứng từ"), (4.6, "Người"), (9.6, "Khoản vay · TSBĐ · HKD"), (14.4, "Phương án vốn")):
        ax.text(x, 10.85, t, ha="center", fontsize=12, fontweight="bold", color="#333")
    ax.set_title(f"Graph hồ sơ {case.get('segment', '')} · {case.get('product_name', '')} · "
                 f"{str(case.get('case_id', ''))[:8]}", fontsize=15, fontweight="bold", loc="left", pad=14)

    handles = [Patch(fc=STYLE[k][0], ec=STYLE[k][1], label=KIND_VI[k]) for k in STYLE]
    handles += [Line2D([], [], color="#9AA3AF", lw=1.2, label="chứng từ nhắc tới người — liên kết chắc"),
                Line2D([], [], color="#C8642A", lw=1.6, ls=(0, (4, 3)),
                       label="chứng từ nhắc tới người — liên kết trung bình")]
    ax.legend(handles=handles, loc="lower left", bbox_to_anchor=(-0.02, -0.085), ncol=5, fontsize=9,
              frameon=False)
    ax.text(16.4, -1.35, "[D#] = chứng từ nguồn của quan hệ  ·  * giá trị TSBĐ lấy từ case.assets, "
            "không gắn bản ghi chứng từ", ha="right", fontsize=8.5, color="#666")
    fig.savefig(out, bbox_inches="tight", facecolor="white")
    print(f"saved {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("graph", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("graph.png"))
    a = ap.parse_args()
    draw(a.graph, a.out)
