#!/usr/bin/env node
/**
 * build-guide.mjs — 由《班網學生（家長）操作手冊》產生班網分頁 guide.html
 *
 * 為什麼要「產生」而不是手寫網頁：
 *   同一份內容維護兩處必然漂移（2026-08-09 已實測 Notion 手冊副本漂了 4 處，鐵則 8 因此由三處改兩處）。
 *   這裡讓 `docs/學生操作手冊.md` 保持唯一正本，網頁只是它的呈現，改完 md 跑一次本腳本即可。
 *
 * 用法：node scripts/build-guide.mjs
 *   輸入 docs/學生操作手冊.md → 輸出 guide.html（整檔覆寫，不要手改 guide.html）
 *
 * 維護者專用、不想出現在學生網頁上的段落，在 md 裡用註解夾住即可（GitHub 上看 md 不受影響）：
 *   <!-- no-web:start -->  …  <!-- no-web:end -->
 *
 * 支援的 Markdown 子集（手冊實際只用到這些）：標題 #/##/###、表格、引言 >、
 * 有序／無序清單（含縮排續行）、**粗體**、水平線、段落、裸網址。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "docs", "學生操作手冊.md");
const OUT = path.join(ROOT, "guide.html");

const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

// 行內語法：先 escape 再套粗體與連結，避免把使用者內容當成標記
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/(https?:\/\/[^\s，。）)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

const md = await readFile(SRC, "utf8");

// 抽掉維護者專用段落
const body = md.replace(/<!--\s*no-web:start\s*-->[\s\S]*?<!--\s*no-web:end\s*-->\n?/g, "");
const lines = body.split("\n");

const sections = [];   // { title, html[] }
let cur = null;        // 目前 section
const push = h => { if (!cur) sections.push(cur = { title: "", html: [] }); cur.html.push(h); };

let i = 0;
while (i < lines.length) {
  const raw = lines[i];
  const line = raw.trim();

  if (!line || /^-{3,}$/.test(line)) { i++; continue; }

  if (line.startsWith("# ")) { i++; continue; }  // H1＝頁面標題，由版型負責

  if (line.startsWith("## ")) {
    sections.push(cur = { title: line.slice(3).trim(), html: [] });
    i++; continue;
  }

  if (line.startsWith("### ")) { push(`<h3>${inline(line.slice(4).trim())}</h3>`); i++; continue; }

  // 表格：本行以 | 開頭，且下一行是分隔列
  if (line.startsWith("|") && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? "").trim())) {
    const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
    const head = cells(line);
    i += 2;
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
    push(`<div class="guide-table-wrap"><table class="guide-table">
<thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("\n")}</tbody>
</table></div>`);
    continue;
  }

  // 引言
  if (line.startsWith(">")) {
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith(">")) buf.push(lines[i++].trim().replace(/^>\s?/, ""));
    push(`<blockquote class="guide-note">${buf.map(inline).join("<br />")}</blockquote>`);
    continue;
  }

  // 清單（有序／無序）；縮排續行併入前一項
  const isItem = l => /^(-\s+|\d+\.\s+)/.test(l.trim());
  if (isItem(raw)) {
    const ordered = /^\d+\.\s+/.test(line);
    const items = [];
    while (i < lines.length) {
      const l = lines[i];
      if (isItem(l)) { items.push(l.trim().replace(/^(-\s+|\d+\.\s+)/, "")); i++; continue; }
      if (l.trim() && /^\s+\S/.test(l) && items.length) { items[items.length - 1] += " " + l.trim(); i++; continue; }
      break;
    }
    const tag = ordered ? "ol" : "ul";
    push(`<${tag} class="guide-list">${items.map(t => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
    continue;
  }

  // 一般段落（連續非空行併成一段）
  const buf = [];
  while (i < lines.length && lines[i].trim() && !/^(#|>|\||-\s|\d+\.\s|-{3,})/.test(lines[i].trim())) buf.push(lines[i++].trim());
  push(`<p>${buf.map(inline).join(" ")}</p>`);
}

const withTitle = sections.filter(s => s.title);
const nav = withTitle.map((s, n) => `<a href="#g${n + 1}">${inline(s.title)}</a>`).join("");
const cards = withTitle.map((s, n) => `      <section class="card guide-card" id="g${n + 1}">
        <h2>${inline(s.title)}</h2>
${s.html.map(h => "        " + h).join("\n")}
      </section>`).join("\n\n");

// 無標題的開頭段落（H1 底下那幾行）放在最前面當引言
const lead = sections.filter(s => !s.title).flatMap(s => s.html).map(h => "      " + h).join("\n");

const html = `<!DOCTYPE html>
<!-- ⚠️ 本檔由 scripts/build-guide.mjs 從 docs/學生操作手冊.md 產生，請勿手改；改內容請改 md 後重跑腳本 -->
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>班級網站</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Huninn&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/css/style.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏫</text></svg>" />
</head>
<body data-page-title="怎麼用這個網站">
  <header id="site-header" class="site-header"></header>
  <nav id="site-nav" class="site-nav"></nav>
  <main id="main">
    <section class="card guide-hero">
      <h2>❓ 怎麼用這個網站</h2>
${lead}
      <nav class="guide-jump" aria-label="快速跳到">${nav}</nav>
    </section>

${cards}
  </main>
  <footer id="site-footer" class="site-footer"></footer>
  <script src="assets/js/common.js"></script>
  <script>App.init("guide");</script>
</body>
</html>
`;

await writeFile(OUT, html, "utf8");
console.log(`✅ guide.html 已產生（${withTitle.length} 個章節，${html.length} 位元組）`);
