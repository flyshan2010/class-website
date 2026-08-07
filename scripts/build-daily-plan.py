#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日課程進度表（xlsx）→ data/daily-plan.json

用法（在 class-website/ 底下執行）：
    python3 scripts/build-daily-plan.py

輸入：../115學年度四上每日課程進度表.xlsx（正本；老師改這份，改完重跑本腳本）
      data/schedule.json（日課表；決定每天哪一節上哪一科）
輸出：data/daily-plan.json（教學駕駛艙行事曆檢視的資料來源）

── 為什麼需要「智慧對齊」 ────────────────────────────────────────────
進度表是「每天每科各寫一條」（每科 5 條／週），但日課表的實際節數是
國語 5 節、數學 4 節、社會 3 節（週三第三節／週四第四節／週五第二節）。
若照日期硬掛，社會「第1節」（進度表寫在週二）那天根本沒課，會被整節跳過。

因此本腳本改以「日課表的實際節次」為時間軸，把該週該科的**實質教學內容**
依序填進去：
  ・社會：只取寫有「第N節：」的列當實質內容（正好 3 條 ↔ 3 節）；
          「課前預習」「知識延伸」等彈性內容改列入該週「彈性補充」。
          複習週沒有「第N節：」標記時，退回取全部列依序填。
  ・數學：全部列依序填入 4 節，填不下的（多為週五的複習訂正）列入彈性補充。
  ・國語：5 條 ↔ 5 節，一對一。
放假日（【放假不排新課】）不佔節次，也不吃掉當週的進度條目。

⚠️ 日課表（data/schedule.json）若有調整，必須重跑本腳本，
   否則 daily-plan.json 裡的節次對齊會是舊的。
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent          # class-website/
XLSX = ROOT.parent / "115學年度四上每日課程進度表.xlsx"  # 班級事務/
SCHEDULE = ROOT / "data" / "schedule.json"
OUT = ROOT / "data" / "daily-plan.json"

SUBJECTS = ["國語", "數學", "社會"]          # 進度表的三個科目欄（＝導師自己上的課）
HOLIDAY_MARK = "【放假不排新課】"
DOW_NAME = {"星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4, "星期五": 5}
SECTION_RE = re.compile(r"第\s*\d+\s*節\s*[：:]")   # 社會「第1節：家鄉的位置與地圖」


def blank(text: str) -> bool:
    """空白／破折號／放假 → 不是實質教學內容"""
    t = (text or "").strip()
    return t in ("", "-", "—", "－", HOLIDAY_MARK)


def read_progress(path: Path):
    """讀進度表，回傳 [{week, date, dow, note, subjects:{科目: 進度文字}}]，依日期排序"""
    ws = openpyxl.load_workbook(path, data_only=True)["每日課程進度表"]
    rows = []
    for r in ws.iter_rows(min_row=4, values_only=True):
        week_s, date_v, dow_s, chi, mat, soc, note = (list(r) + [None] * 7)[:7]
        if not week_s or not date_v:
            continue
        m = re.search(r"(\d+)", str(week_s))
        if not m:
            continue
        date = date_v.date() if hasattr(date_v, "date") else datetime.strptime(str(date_v), "%Y/%m/%d").date()
        rows.append({
            "week": int(m.group(1)),
            "date": date.isoformat(),
            "dow": DOW_NAME.get(str(dow_s).strip(), date.isoweekday()),
            "note": (str(note).strip() if note else ""),
            "subjects": {
                "國語": (str(chi).strip() if chi else ""),
                "數學": (str(mat).strip() if mat else ""),
                "社會": (str(soc).strip() if soc else ""),
            },
        })
    rows.sort(key=lambda d: d["date"])
    return rows


def read_slots(path: Path):
    """讀日課表，回傳 ({科目: [(星期, 節次名, 節次序), ...]}, {節次名: 節次序})"""
    sched = json.loads(path.read_text(encoding="utf-8"))
    periods = [p["name"] for p in sched["periods"]]
    slots = {s: [] for s in SUBJECTS}
    for pi, row in enumerate(sched["table"]):
        for di, cell in enumerate(row):
            if isinstance(cell, dict) and cell.get("subject") in slots:
                slots[cell["subject"]].append((di + 1, periods[pi], pi))
    for s in slots:
        slots[s].sort(key=lambda t: (t[0], t[2]))
    return slots, {name: i for i, name in enumerate(periods)}


def align_week(days, slots):
    """把一週的進度內容對齊到日課表的實際節次。

    回傳 (plan, extras)
      plan   = {(星期, 節次名): {"subject":…, "text":…}}
      extras = [{"subject":…, "text":…, "date":…}]  ← 沒排進固定節次的彈性補充
    """
    holidays = {d["dow"] for d in days if d["holiday"]}
    plan, extras = {}, []

    for subject in SUBJECTS:
        # 該科當週的實質內容（放假日與空白／破折號都不算）
        entries = [{"subject": subject, "text": d["subjects"][subject], "date": d["date"]}
                   for d in days if not blank(d["subjects"][subject])]
        if not entries:
            continue

        # 社會：優先只取「第N節：」的列當正課；複習週沒有標記就退回全取
        marked = [e for e in entries if SECTION_RE.search(e["text"])]
        core = marked if (subject == "社會" and marked) else entries
        rest = [e for e in entries if e not in core]

        # 該科當週實際可用的節次（放假日不算）
        avail = [(dow, name) for dow, name, _ in slots[subject] if dow not in holidays]

        for i, (dow, name) in enumerate(avail):
            if i < len(core):
                plan[(dow, name)] = {"subject": subject, "text": core[i]["text"]}
        # 填不下的正課 ＋ 非正課的彈性內容 → 本週彈性補充（依原本日期順序）
        overflow = core[len(avail):]
        extras.extend(sorted(overflow + rest, key=lambda e: e["date"]))

    # 同一則補充在同一週重複出現（例如複習週連兩天同文字）只留第一筆
    seen, uniq = set(), []
    for e in extras:
        key = (e["subject"], e["text"])
        if key not in seen:
            seen.add(key)
            uniq.append(e)
    return plan, uniq


def main():
    if not XLSX.exists():
        sys.exit(f"❌ 找不到進度表正本：{XLSX}")
    rows = read_progress(XLSX)
    slots, period_order = read_slots(SCHEDULE)

    for d in rows:
        d["holiday"] = all(d["subjects"][s].strip() == HOLIDAY_MARK for s in SUBJECTS)

    weeks = {}
    for d in rows:
        weeks.setdefault(d["week"], []).append(d)

    out_days = []
    for wk in sorted(weeks):
        days = weeks[wk]
        plan, extras = align_week(days, slots)
        for d in days:
            out_days.append({
                "date": d["date"],
                "week": wk,
                "dow": d["dow"],
                "holiday": d["holiday"],
                "note": d["note"],
                # 當天的節次安排：{節次名: {subject, text}}，依日課表節次順序排好
                "plan": {name: v for (dow, name), v in
                         sorted(plan.items(), key=lambda kv: period_order.get(kv[0][1], 99))
                         if dow == d["dow"]},
                # 本週彈性補充（同一週每天相同，方便老師任何一天都看得到）
                "extras": [{"subject": e["subject"], "text": e["text"], "date": e["date"]} for e in extras],
            })

    payload = {
        "meta": {
            "source": XLSX.name,
            "schedule": "data/schedule.json",
            "builtAt": datetime.now().isoformat(timespec="seconds"),
            "days": len(out_days),
            "weeks": len(weeks),
            "note": "由 scripts/build-daily-plan.py 產生，請勿手改；改進度表 xlsx 或日課表後重跑。",
        },
        "days": out_days,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    filled = sum(len(d["plan"]) for d in out_days)
    print(f"✅ {OUT.relative_to(ROOT)}：{len(out_days)} 個上課日／{len(weeks)} 週，"
          f"共排定 {filled} 節，放假日 {sum(1 for d in out_days if d['holiday'])} 天")


if __name__ == "__main__":
    main()
