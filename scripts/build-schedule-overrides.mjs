/* 調課對照表：data/calendar.json ＋ data/schedule.json → data/schedule-overrides.json（零相依，Node 18+）
 *
 * 老師只在 Google 日曆填一次調課，三站（班網／class-manager／自學星圖）一起變，
 * 而且**只變那一天**——學年課表 schedule.json 一個字都不動。
 *
 * 老師的寫法（現行實例，不必改習慣）：
 *   標題「數學（調9/10第三節）」・日期 2026-09-09・時間 10:30-11:20
 *   → 意思是「9/9 第三節改上數學（跟 9/10 第三節對調）」
 *
 * 判別規則（兩條都要成立才算調課，寧可漏抓也不要誤抓）：
 *   ① 標題含「調」——這是判別器。沒有它就只是一般活動。
 *   ② 事件的 startTime 對得上 schedule.json 某一節的起始時間
 *      （「學力檢測 08:40-11:10」這種跨多節的活動因此不會被誤認成調課）。
 * 那一節的新科目＝標題「（」之前的那一段。
 *
 * 輸出：{ "2026-09-09": { "第三節": { subject, title, from } }, ... }
 *   from＝括號裡那段原文（"調9/10第三節"），前端要顯示「調課」小標時用得到。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const read = async n => JSON.parse(await readFile(path.join(DATA_DIR, n), "utf8"));

const events = await read("calendar.json");
const sched = await read("schedule.json");

/* 節次起始時間 → 節次名稱。schedule.json 的 time 寫成 "10:30-11:20"。 */
const startOf = t => (String(t || "").match(/(\d{1,2})[:：](\d{2})/) || [])[0]?.replace("：", ":") || "";
const byStart = {};
for (const p of sched.periods || []) {
  const s = startOf(p.time);
  if (s) byStart[s.padStart(5, "0")] = p.name;
}

const out = {};
let n = 0;
for (const e of events) {
  const title = String(e.title || "").trim();
  if (!title.includes("調")) continue;                       // ① 判別器
  const period = byStart[String(e.startTime || "").padStart(5, "0")];
  if (!period) continue;                                     // ② 時間對不上任何一節
  const subject = title.split(/[（(]/)[0].trim();
  if (!subject) continue;
  const from = (title.match(/[（(]([^）)]*)[）)]/) || [])[1] || "";
  (out[e.date] ||= {})[period] = { subject, title, from };
  n++;
}

await writeFile(
  path.join(DATA_DIR, "schedule-overrides.json"),
  JSON.stringify({
    _說明: "當天調課對照表。由 build-schedule-overrides.mjs 從 data/calendar.json 推算，請勿手改；"
         + "要改調課請改 Google 日曆那筆事件（標題含「調」＋時間對上某一節）。"
         + "學年課表 schedule.json 不受影響，只有列在這裡的那一天那一節會換科目。",
    來源: "data/calendar.json（標題含「調」且 startTime 對上 schedule.json 某一節）",
    days: out,
  }, null, 2) + "\n",
  "utf8"
);
console.log(`✅ schedule-overrides.json（${n} 筆調課，涵蓋 ${Object.keys(out).length} 天）`);
