/**
 * f30｜系統健檢 → 有紅燈才進收件匣（週五自動收尾的一環）
 * ───────────────────────────────────────────────────────────────
 * 背景（老師 2026-09-12）：週五要的四樣成果之一是「系統檢查警示」。
 *   健檢腳本本身跑在本機或 Actions log 裡，**沒人會主動去看 log**——
 *   紅燈要自己跑到老師眼前（收件匣），才叫警示。
 *
 * 行為：跑 `node scripts/health-check.mjs`（它自己 exit 1 代表有紅燈）。
 *   - 全綠：**不建任何列**（乾淨就安靜，不然每週一筆雜訊會讓老師學會忽略它）
 *   - 有紅燈：收件匣建／刷新一列「系統健檢紅燈（日期）」狀態＝待審，紅黃燈原文寫進執行紀錄
 *   同一天重跑會刷新同一列，不會疊。
 *
 * ⚠️ 健檢輸出可能含檔名與路徑，但不含學生個資（健檢只看檔案與線上頁面）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, api, updatePage, DS } from "./lib/notion.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const YEAR = String(Number(today.slice(0, 4)) - 1911 - (Number(today.slice(5, 7)) < 8 ? 1 : 0));

const run = spawnSync(process.execPath, ["scripts/health-check.mjs"], { cwd: ROOT, encoding: "utf8" });
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
console.log(out || "（健檢沒有輸出）");

if (run.status === 0) {
  console.log("\n✅ 健檢全綠 → 不在收件匣建列（乾淨就安靜）");
  process.exit(0);
}

// 只留紅黃燈與結論行，去掉「通過」清單（執行紀錄有 2000 字上限）
const keep = out.split("\n").filter(l => /^(❌|⚠️|\s+→)/.test(l) || /紅　/.test(l)).join("\n");
const body = `【系統健檢紅燈】${today}（自動）\n\n${keep || out}\n\n處理方式：照每條的「→」修，或在 Claude Code 說「跑系統健檢」看完整輸出。\n判準與白名單：scripts/health-check.mjs／health-check.config.json（誤報就加白名單，別把檢查關掉）。`;
const title = `系統健檢紅燈（${today}）`;

const prev = (await queryAll(DS.inbox)).find(p =>
  (p.properties?.["任務原文"]?.title ?? []).map(t => t.plain_text).join("").includes(title)
  && (p.properties?.["狀態"]?.select?.name ?? "") === "待審");

if (prev) {
  const u = await updatePage(prev.id, { "執行紀錄": { rich_text: rt(body) } });
  if (!u.ok) { console.error(`❌ 刷新健檢待審列失敗：${u.status} ${u.json?.message ?? ""}`); process.exit(1); }
  console.log(`\n♻️ 已刷新收件匣既有的健檢紅燈列`);
  process.exit(0);
}

const r = await api("POST", "/pages", {
  parent: { type: "data_source_id", data_source_id: DS.inbox },
  properties: {
    "任務原文": { title: rt(title) },
    "狀態": { select: { name: "待審" } },
    "路由ID": { rich_text: rt("健檢") },
    "執行紀錄": { rich_text: rt(body) },
    "學年": { select: { name: YEAR } },
  },
});
if (!r.ok) { console.error(`❌ 建立健檢待審列失敗：${r.status} ${r.json?.message ?? ""}`); process.exit(1); }
console.log(`\n🔔 健檢有紅燈，已在收件匣建立待審列：${title}`);
