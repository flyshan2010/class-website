/**
 * 班網 lessons/ 原址換轉址頁（一次性，2026-10-10；SPEC_全雲端架構 §5.4）
 * 教材已搬到公開教材庫 https://flyshan2010.github.io/lessons/，Notion 教學單元網址也已切換（f44）。
 * GitHub Pages 沒有伺服器轉址，所以把這裡每一頁換成極小的轉址頁（自動跳轉＋一條可點的連結），
 * 讓已發給家長的舊連結照樣看得到教材。網址路徑一對一，連 ?查詢 與 #錨點 都帶過去。
 *
 * 用法：node scripts/lessons-redirect.mjs          → 只列不寫
 *       node scripts/lessons-redirect.mjs --write  → 改寫 HTML、刪掉轉址頁用不到的 css／js
 * 退回：git revert 這個 commit（原 HTML 全部回來）。
 */
import { readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "lessons";
const NEW = "https://flyshan2010.github.io/lessons/";
const WRITE = process.argv.includes("--write");

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const page = (url) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>教材已搬家</title>
<link rel="canonical" href="${url}">
<script>location.replace(${JSON.stringify(url)} + location.search + location.hash);</script>
<meta http-equiv="refresh" content="1; url=${url}">
</head>
<body style="font-family:sans-serif;padding:2em;line-height:1.8">
<p>這份教材已搬到新網址，正在為您轉過去……</p>
<p>沒有自動跳轉請點：<a href="${url}">${url}</a></p>
</body>
</html>
`;

let html = 0, removed = 0;
for (const f of walk(ROOT)) {
  if (f.endsWith(".html")) {
    const url = NEW + relative(ROOT, f).split(sep).map(encodeURIComponent).join("/");
    if (WRITE) writeFileSync(f, page(url));
    html++;
  } else {
    if (WRITE) unlinkSync(f);
    removed++;
    console.log(`${WRITE ? "已刪" : "會刪"}：${f}`);
  }
}
console.log(`${WRITE ? "已改寫" : "會改寫"} ${html} 個 HTML 為轉址頁｜${WRITE ? "已刪" : "會刪"} ${removed} 個非 HTML 檔`);
