#!/usr/bin/env python3
"""試後分析表填表（DH 線，老師 2026-11-06 定案）

把 f55 產的 post-exam/1 JSON（＋Claude 起草的文字欄）填進學校原表「崑山國小定期評量試後檢討分析表」，
一科一份 .docx。只負責「填」：數字、門檻、註記都由 lib/term-exam.mjs 算好，這裡不重算（U83）。

用法：
  python3 fill_form.py <f55 json> --drafts <drafts.json> --outdir <輸出資料夾>
drafts.json（Claude 讀試卷起草，老師改）：
  { "數學": { "一2": ["錯誤分析與教學醒思", "補救教學策略"], ... }, ... }
  沒起草的題目文字欄寫「（請老師填寫）」，不會留白也不會亂猜。
"""
import argparse, copy, json, subprocess, sys, tempfile
from pathlib import Path
import docx
from docx.shared import Pt

HERE = Path(__file__).parent
TEMPLATE = HERE / "試後分析表_原表.docx"

# 固定欄位（老師 2026-11-06 裁定）
CLASS = ("四", "4")  # 404 班
TEACHER = "張俊賢"
VERSION = {"國語": "翰林", "數學": "翰林", "社會": "康軒"}
TODO = "（請老師填寫）"


def set_par(p, text):
    for run in p.runs[1:]:
        run._element.getparent().remove(run._element)
    if p.runs:
        p.runs[0].text = text
    else:
        p.add_run(text)


def set_cell(c, text, size=None):
    p = c.paragraphs[0]
    ppr = p._p.pPr  # 原表儲存格殘留自動編號，不拿掉會冒出「1.」
    if ppr is not None and ppr.numPr is not None:
        ppr.remove(ppr.numPr)
    set_par(p, text)
    for extra in c.paragraphs[1:]:
        extra._element.getparent().remove(extra._element)
    pf = p.paragraph_format  # 原表儲存格行距很鬆，縮成單行距才放得進一頁
    pf.line_spacing, pf.space_before, pf.space_after = 1.0, Pt(0), Pt(0)
    if size:
        for run in p.runs:
            run.font.size = Pt(size)


def fill(subj, drafts, term):
    d = docx.Document(TEMPLATE)
    g, cls = CLASS
    y, m, dd = subj["date"].split("-") if subj.get("date") else ("", "　", "　")
    roc = str(int(y) - 1911) if y else "　"
    for p in d.paragraphs:
        t = p.text.strip()
        if t.startswith("評量班級"):
            set_par(p, f"  評量班級：　{g}　年　{cls}　班　　　　　評量科目：　{subj['subject']}　（　{VERSION.get(subj['subject'], '')}　版）")
        elif t.startswith("考試日期"):
            set_par(p, f"考試日期：　{roc}　年　{m}　月　{dd}　日　　　　授課教師：　{TEACHER}")
        elif t.startswith("應考人數"):
            set_par(p, f"應考人數：　{subj['n']}　人" + (f"（缺考 {subj['absent']} 人另行補考）" if subj["absent"] else ""))
        elif t.startswith("說明"):
            set_par(p, "說明：" + subj["summary"])
    for p in d.paragraphs[1:]:  # 標題以外的段落行距縮成單行距（原表行距很鬆，題目一多就擠出第 2 頁）
        pf = p.paragraph_format
        pf.line_spacing, pf.space_before, pf.space_after = 1.0, Pt(0), Pt(2)
    prev_empty = False  # 原表連續空行很多，只留一行
    for p in list(d.paragraphs[:-1]):
        empty = not p.text.strip()
        if empty and prev_empty:
            p._element.getparent().remove(p._element)
        prev_empty = empty

    t0, t1 = d.tables
    for i, v in enumerate(subj["bins"]):
        set_cell(t0.rows[1].cells[i], f"{v}　人")
    rows = subj["rows"]
    if not rows:  # 各題都未達 20%：表格留一列說明
        rows = [{"label": "（無）", "wrong": "", "rate": "", "note": "", "remedyPrefix": "", "code": None,
                 "_text": ("各題錯誤率皆未達 20%，多數學生已掌握。", "個別訂正，不另安排全班補救。")}]
    while len(t1.rows) - 1 < len(rows):
        t1._tbl.append(copy.deepcopy(t1.rows[-1]._tr))
    while len(t1.rows) - 1 > len(rows):
        t1._tbl.remove(t1.rows[-1]._tr)
    mine = drafts.get(subj["subject"], {})
    for i, row in enumerate(rows, 1):
        a, b = row.get("_text") or mine.get(row["code"], (TODO, TODO))
        c = t1.rows[i].cells
        set_cell(c[0], row["label"], 10)
        set_cell(c[1], str(row["wrong"]), 10)
        set_cell(c[2], f"{row['rate']}%" if row["rate"] != "" else "", 10)
        set_cell(c[3], a + row["note"], 9)
        set_cell(c[4], row["remedyPrefix"] + b, 9)
    last = d.paragraphs[-1]  # 結尾段落壓到 1pt，避免擠出空白頁
    last.paragraph_format.space_before = last.paragraph_format.space_after = Pt(0)
    last.paragraph_format.line_spacing = Pt(1)
    return d


def pages(path):
    """用 LibreOffice 轉 PDF 數頁數（沒裝就回 None）；字型與 Word 不同，只當警示。
    實測 LibreOffice 同一檔連轉兩次頁數會不同（字型載入不穩：先 2 頁、再轉 1 頁），所以轉三次取最少。"""
    try:
        got = []
        with tempfile.TemporaryDirectory() as tmp:
            for _ in range(3):
                subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(path)],
                               capture_output=True, timeout=120, check=True)
                pdf = next(Path(tmp).glob("*.pdf"))
                out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
                got.append(int(next(l for l in out.splitlines() if l.startswith("Pages:")).split()[1]))
        return min(got)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json")
    ap.add_argument("--drafts", default=None)
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    data = json.loads(Path(a.json).read_text(encoding="utf-8"))
    assert data.get("format") == "post-exam/1", "不是 f55 的 post-exam/1 JSON"
    drafts = json.loads(Path(a.drafts).read_text(encoding="utf-8")) if a.drafts else {}
    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    for subj in data["subjects"]:
        todo = [r["label"] for r in subj["rows"] if r["code"] not in drafts.get(subj["subject"], {})]
        f = out / f"試後分析表_{data['term']}{data['name']}_{subj['subject']}.docx"
        fill(subj, drafts, data["term"]).save(f)
        n = pages(f)
        print(f"✅ {f.name}：{len(subj['rows'])} 列" + (f"；未起草 {len(todo)} 題" if todo else "")
              + (f"；⚠️ 預覽 {n} 頁（超過 1 頁，請縮短文字欄）" if n and n > 1 else f"；預覽 {n} 頁" if n else ""))
    if not data["subjects"]:
        print("⚠️ JSON 裡沒有任何一科（f55 是否全科判不出？看收件匣）")
        sys.exit(1)


if __name__ == "__main__":
    main()
