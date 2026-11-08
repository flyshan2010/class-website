// 執行：node scripts/yearbook-polish-check.mjs <微修稿.json>
// ✨ 校刊一鍵微修的程式把關（SPEC_校刊挑選.md §7；「校刊微修」skill 寫回 Notion 前必跑）。
// 輸入 JSON：[{ id, title, base, revised }]，或改不下來的 [{ id, title, base, manual: "原因" }]
//   base＝Notion「校刊微修建議」〔待微修〕那一行之後的底稿（一字不改照抄）；revised＝微修後全文。
// 檢查（與班網頁面採用前同一支 yearbook-core.js）：改動 ≤5%、段落數不變、不空白。
// 全部通過 → 寫 <同名>.out.json：{ id: 要寫進「校刊微修建議」的全文 }，exit 0；任一不過 → 列原因、不產出、exit 1。
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const Y = createRequire(import.meta.url)("../assets/js/yearbook-core.js");

const file = process.argv[2];
if (!file) { console.error("用法：node scripts/yearbook-polish-check.mjs <微修稿.json>"); process.exit(2); }
const items = JSON.parse(readFileSync(file, "utf8"));
const now = new Date(Date.now() + 8 * 3600e3).toISOString();
const at = now.slice(0, 10) + " " + now.slice(11, 16);   // 臺北時間 yyyy-MM-dd HH:mm

let bad = 0;
const out = {};
for (const it of items) {
  const name = "〈" + (it.title || it.id) + "〉";
  if (!it.id || typeof it.base !== "string" || !it.base.trim()) { console.log("❌ " + name + " 缺 id 或底稿"); bad++; continue; }
  if (it.manual) { out[it.id] = Y.polishManual(it.base, it.manual); console.log("🟡 " + name + " 需人工：" + it.manual); continue; }
  const gate = Y.polishGate(it.base, it.revised);
  const fail = gate.filter(g => !g.ok);
  console.log((fail.length ? "❌ " : "✅ ") + name + " " + gate.map(g => g.m).join("；"));
  if (fail.length) { bad++; continue; }
  if (it.revised.replace(/\r/g, "") === it.base.replace(/\r/g, "")) console.log("   （沒有改動，仍寫回讓老師知道已看過）");
  out[it.id] = Y.polishDone(it.base, it.revised, at);
}
if (bad) { console.log(`\n${bad} 篇沒過把關：重修一次（只留最必要的改動），仍超過就改成 manual 標需人工。未產出寫入檔。`); process.exit(1); }
const dest = file.replace(/\.json$/, "") + ".out.json";
writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`\n全部通過，寫入內容 → ${dest}（${Object.keys(out).length} 篇）`);
