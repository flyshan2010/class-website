#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 ClassOS 藍圖底下的 PLAN_*.md 轉成單檔離線網頁（noindex、RWD、可勾選確認）。
用法：python3 scripts/build-plan-page.py <來源.md> <輸出.html> "<頁面標題>"
改 md 之後重跑即可，網頁不手改——手改會在下次重跑時被蓋掉。"""
import re, sys, io, html

src_path, out_path, page_title = sys.argv[1], sys.argv[2], sys.argv[3]
lines = io.open(src_path, encoding='utf-8').read().split('\n')

def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    return t

out, sections, i, n, title_html = [], [], 0, 0, ''
while i < len(lines):
    l = lines[i]
    if l.startswith('> '):
        buf = []
        while i < len(lines) and lines[i].startswith('> '):
            buf.append(lines[i][2:]); i += 1
        out.append('<blockquote>' + inline(' '.join(buf)) + '</blockquote>'); continue
    if l.startswith('---'):
        out.append('<hr>'); i += 1; continue
    m = re.match(r'^(#{1,4}) (.*)$', l)
    if m:
        lv, txt = len(m.group(1)), m.group(2)
        if lv == 1:
            title_html = '<h1>' + inline(txt) + '</h1>'
        else:
            n += 1; sid = 's%d' % n
            if lv == 2: sections.append((sid, txt))
            out.append('<h%d id="%s">%s</h%d>' % (lv, sid, inline(txt), lv))
        i += 1; continue
    if l.startswith('|'):                                  # 表格
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
        head, body_rows = rows[0], rows[2:]
        t = '<div class="tw"><table><thead><tr>' + ''.join('<th>%s</th>' % inline(c) for c in head) + '</tr></thead><tbody>'
        t += ''.join('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>' for r in body_rows)
        out.append(t + '</tbody></table></div>'); continue
    if l.startswith('- ') or l.startswith('· ') or l.startswith('  · '):
        items = []
        while i < len(lines) and (lines[i].startswith('- ') or lines[i].lstrip().startswith('· ')):
            items.append(lines[i].lstrip(' ·-').strip()); i += 1
        out.append('<ul>' + ''.join('<li>%s</li>' % inline(x) for x in items) + '</ul>'); continue
    if l.strip() == '':
        i += 1; continue
    para = []                                              # 連續文字行併成同一段（md 的換行不是分段）
    while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||-|>|·|---)', lines[i]):
        para.append(lines[i].strip()); i += 1
    out.append('<p>' + inline(''.join(para)) + '</p>')

body = '\n'.join(out)
# 「**`國R1-1` 標題**」＋其後的清單 → 一張可勾選的輪次卡
# 標題內可能有多個 <code>（`數R1-2`／`數R1-3`／`數R1-4` 三輪循環），所以不能用 [^<]* 卡死
def _card(m):
    inner = m.group(1)
    key = re.sub('<[^>]+>', '', inner).strip()
    tail = re.sub('<[^>]+>', '', m.group(2)).strip()
    return ('<div class="round"><label class="chk"><input type="checkbox" data-k="%s">'
            '<span><b>%s</b>%s</span></label><ul>'
            % (html.escape(key), inner, html.escape(tail)))
body = re.sub(r'<p><strong>(.*?)</strong>(.*?)</p>\n<ul>', _card, body)
parts = body.split('<div class="round">')
body = parts[0] + ''.join('<div class="round">' + p.replace('</ul>', '</ul></div>', 1) for p in parts[1:])
toc = ''.join('<a href="#%s">%s</a>' % (sid, html.escape(t)) for sid, t in sections)

TPL = '''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>__TITLE__</title>
<style>
:root{--bg:#f7f5f0;--card:#fff;--ink:#2b2b2b;--muted:#6b6b6b;--line:#e2ddd2;--accent:#8a6d3b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.75}
.wrap{max-width:1000px;margin:0 auto;padding:20px 18px 80px}
h1{font-size:1.7rem;margin:.1em 0 .4em}
h2{font-size:1.25rem;margin:2em 0 .6em;padding-left:.5em;border-left:6px solid var(--accent)}
h3{font-size:1.06rem;margin:1.6em 0 .5em;color:var(--accent)}
blockquote{background:#fffbe9;border:1px solid #ecdca9;border-radius:10px;padding:12px 14px;color:#6a5a2a;font-size:.92rem;margin:14px 0}
hr{border:0;border-top:2px dashed var(--line);margin:2.4em 0}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0}
table{border-collapse:collapse;width:100%;min-width:520px;background:var(--card);border-radius:10px;overflow:hidden;font-size:.93rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#efe9dd;font-weight:600;white-space:nowrap}
code{background:#efe9dd;border-radius:5px;padding:1px 5px;font-size:.9em;font-family:ui-monospace,Menlo,monospace}
ul{margin:.4em 0 .8em;padding-left:1.2em}
li{margin:.25em 0}
.round{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:10px;padding:12px 14px;margin:14px 0}
.round.done{opacity:.55;border-left-color:#8aa88a}
.chk{display:flex;gap:.5em;align-items:flex-start;cursor:pointer}
.chk input{margin-top:.5em;width:18px;height:18px;flex:none;accent-color:#8aa88a}
.chk b{color:var(--accent)}
.toc{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap}
.toc a{font-size:.82rem;text-decoration:none;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 10px}
.toc a:hover{color:var(--ink);border-color:var(--accent)}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}
.bar button{font:inherit;font-size:.85rem;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer}
.tip{color:var(--muted);font-size:.85rem}
@media print{.toc,.bar{display:none}.round{break-inside:avoid}body{background:#fff}}
@media (max-width:600px){h1{font-size:1.35rem}.wrap{padding:14px 12px 60px}}
</style>
</head>
<body>
<div class="wrap">
__TITLE_H1__
<div class="toc">__TOC__</div>
<div class="bar">
  <button onclick="window.print()">🖨 列印／存 PDF</button>
  <button onclick="localStorage.removeItem('plan-check');location.reload()">↺ 清除勾選</button>
  <span class="tip">勾選只存在這台裝置的瀏覽器，方便逐輪確認</span>
</div>
__BODY__
</div>
<script>
(function(){
  var K='plan-check', st=JSON.parse(localStorage.getItem(K)||'{}');
  document.querySelectorAll('.round input[type=checkbox]').forEach(function(b){
    var k=b.dataset.k; b.checked=!!st[k]; b.closest('.round').classList.toggle('done',b.checked);
    b.addEventListener('change',function(){ st[k]=b.checked; localStorage.setItem(K,JSON.stringify(st));
      b.closest('.round').classList.toggle('done',b.checked); });
  });
})();
</script>
</body>
</html>'''
io.open(out_path, 'w', encoding='utf-8').write(
    TPL.replace('__TITLE__', html.escape(page_title))
       .replace('__TITLE_H1__', title_html)
       .replace('__TOC__', toc)
       .replace('__BODY__', body))
print('已產出', out_path)
