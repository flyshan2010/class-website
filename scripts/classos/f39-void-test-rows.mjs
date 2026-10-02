/**
 * f39｜讓 10/02 深夜試跑多入庫的 3 列測試紀錄立即失效（一次性，2026-10-03）
 * ───────────────────────────────────────────────────────────────
 * 背景：老師 10/02 23:55 用 class-manager 試跑作業科目（R18 run 37030407562），33 筆裡 27 筆已入庫被去重、
 *   新入庫 3 筆（座號7／12／15 各 −5，日期 10/02）。第 5 週週結已於 10/02 下午完成，f29 只讀試算
 *   （run 37035834181）列為「待入帳 3 筆／−15 幣」。老師 2026-10-03 確認：**只是測試**，不可扣。
 *
 * 做法（RULE_Notion操作限制 §1：DB 列不搬、標題加【待刪】讓它失效，老師手動刪）：
 *   ① 事件描述前加「【待刪】」  ② 金幣影響改 0——f29 撈「金幣影響≠0」入帳，只改標題擋不住重跑扣錢
 *   事件id 保留（重送仍會被 R18 去重）。帳本一筆都不動（本來就還沒入帳）。
 * 鎖定條件＝f29 同一套判法：該週、金幣影響≠0、帳本沒有（紀錄id×學生id）入帳鍵。
 *   找到的必須**正好是**座號7、12、15 各 −5 三列，否則一筆都不寫（交人工）。
 *
 * MODE=dry-run（預設）／execute。⚠️ PUBLIC repo：只印座號與金額。
 */
import { queryAll, api, isExecute, DS } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const WEEK = "四上第5週(9/28-10/2)";
const EXPECT = "7:-5,12:-5,15:-5";
const PREFIX = "【待刪】";
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map((r) => r.id);
const title = (p) => (p.properties?.事件描述?.title ?? []).map((t) => t.plain_text).join("");
const rt = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];

console.log(`f39｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}`);
const roster = await queryAll(DS.roster);
const seatOf = new Map(roster.map((p) => [p.id, p.properties?.座號?.number]));

const booked = new Set();
for (const b of await queryAll(DS.bank)) for (const lid of relIds(b, "紀錄庫")) for (const sid of relIds(b, "學生")) booked.add(`${lid}|${sid}`);

const logs = (await queryAll(DS.log, { filter: { property: "週次", rich_text: { equals: WEEK } } }))
  .filter((p) => (p.properties?.金幣影響?.number ?? 0) !== 0)
  .filter((p) => relIds(p, "學生").some((sid) => !booked.has(`${p.id}|${sid}`)));
const got = logs.map((p) => `${relIds(p, "學生").map((s) => seatOf.get(s)).join("+")}:${p.properties.金幣影響.number}`).sort((a, b) => parseInt(a) - parseInt(b)).join(",");
console.log(`未入帳且金幣≠0 的列：${got || "（無）"}`);
if (got !== EXPECT) { console.log(`❌ 與預期（${EXPECT}）不符——一筆都不寫，請人工確認`); process.exit(1); }
if (logs.some((p) => title(p).startsWith(PREFIX))) { console.log("❌ 已有列帶【待刪】，可能重跑過——不寫"); process.exit(1); }
if (!EXECUTE) { console.log("🔍 DRY-RUN：條件吻合，未寫入。"); process.exit(0); }

let ok = 0;
for (const p of logs) {
  const w = await api("PATCH", `/pages/${p.id}`, { properties: { 事件描述: { title: rt(PREFIX + title(p)) }, 金幣影響: { number: 0 } } });
  const back = w.ok ? (await api("GET", `/pages/${p.id}`)).json : null;   // 回讀：寫入成功≠內容正確
  const good = back && title(back).startsWith(PREFIX) && back.properties?.金幣影響?.number === 0;
  console.log(`${good ? "✅" : "❌"} 座號${relIds(p, "學生").map((s) => seatOf.get(s)).join("、")}：標題加【待刪】、金幣影響 0${good ? "（回讀相符）" : `（HTTP ${w.status}）`}`);
  if (good) ok++;
}
console.log(`完成 ${ok}／${logs.length} 列`);
process.exitCode = ok === logs.length ? 0 : 1;
