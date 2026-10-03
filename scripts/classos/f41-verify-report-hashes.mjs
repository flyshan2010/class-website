/**
 * f41｜只讀驗收：第 1–5 週學習報告個人句＋第 1–4 週週報課程重點是否逐字寫入（2026-10-03）
 * ───────────────────────────────────────────────────────────────
 * 背景：112 頁由 MCP 逐頁寫入（三級距個人句＋作業提醒句），抽查 26 欄全對，
 *   但寫入過程曾出現一個錯字被 hook 攔下，需全量機械比對。
 * 做法：data/f41-expected-hashes.json 只存 sha256(頁面id|預期字串)，不存任何文字；
 *   逐頁讀回欄位，換行正規化成 <br> 後算同樣的雜湊比對。永遠只讀，不寫 Notion。
 * ⚠️ PUBLIC repo：只印頁面短碼與欄位名，不印內容。
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { api, propText, shortId } from "./lib/notion.mjs";

const EXP = JSON.parse(readFileSync(new URL("./data/f41-expected-hashes.json", import.meta.url)));
const h = (pid, s) => createHash("sha256").update(`${pid}|${s}`).digest("hex");
let fields = 0, bad = 0;
for (const [pid, want] of Object.entries(EXP)) {
  const r = await api("GET", `/pages/${pid}`);
  if (!r.ok) { console.log(`❌ ${shortId(pid)} 讀取失敗 ${r.status}`); bad++; continue; }
  for (const [k, hv] of Object.entries(want)) {
    fields++;
    const v = propText(r.json, k);
    if (v === null) { console.log(`❌ ${shortId(pid)} 找不到欄位「${k}」`); bad++; continue; }
    if (h(pid, v.replace(/\r?\n/g, "<br>")) !== hv && h(pid, v) !== hv) { console.log(`❌ ${shortId(pid)}「${k}」與定稿不符`); bad++; }
  }
  await new Promise((s) => setTimeout(s, 350));
}
console.log(`f41｜頁數 ${Object.keys(EXP).length}，欄位 ${fields}，不符 ${bad}`);
process.exit(bad ? 1 : 0);
