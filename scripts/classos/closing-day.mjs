/**
 * closing-day｜今天是不是「本週最後一個上課日」（每週收尾的閘門）
 * ───────────────────────────────────────────────────────────────
 * 2026-10-06 老師裁定：每週收尾改在該週最後一個上課日跑，不再寫死週五。
 * 排程一律週一～週五都觸發，**第一步先跑這支**，不是收尾日就立刻結束。
 * 判定正本＝lib/school-days.mjs；資料＝data/daily-plan.json（Notion「📅 每日課程進度」同步來的）。
 *
 * 用法：node scripts/classos/closing-day.mjs [yyyy-mm-dd]      （不給日期＝台北今天）
 * 輸出（第一行給人與模型讀，逐字比對開頭即可）：
 *   CLOSING-DAY: YES｜…   → 今天是收尾日，繼續往下做
 *   CLOSING-DAY: NO｜…    → 不是，本輪結束
 *   CLOSING-DAY: UNKNOWN｜… → 判不出（學期中但每日課程進度沒有本週資料），需人工
 * 結束碼：YES／NO＝0，UNKNOWN＝2。GitHub Actions 另寫 `closing=yes|no` 到 $GITHUB_OUTPUT。
 */
import { readFile, appendFile } from "node:fs/promises";
import { weekInfo } from "./lib/school-days.mjs";

const DATA = new URL("../../data/", import.meta.url);
const readJSON = async f => JSON.parse(await readFile(new URL(f, DATA), "utf8"));

const arg = process.argv[2] || process.env.CLOSING_TODAY || "";
const today = /^\d{4}-\d{2}-\d{2}$/.test(arg)
  ? arg : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

const plan = await readJSON("daily-plan.json");
const weeks = await readJSON("weeks.json");
const term = (weeks.學期 ?? []).flatMap(t => t.週 ?? []).find(x => today >= x.起 && today <= x.迄);
const w = weekInfo(plan, today, term ? { from: term.起, to: term.迄 } : {});

const out = async v => { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `closing=${v}\n`); };
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

if (!term) {
  // 學期區間外：假期，或老師的「預排日」（歸下學期第1週的緩衝日，不收尾）
  console.log(`CLOSING-DAY: NO｜${today} 不在任何上課週內（假期或預排日）`);
  await out("no");
  process.exit(0);
}
if (!w.known) {
  {
    console.log(`CLOSING-DAY: UNKNOWN｜${today} 在 ${term.標籤} 內，但每日課程進度沒有本週資料，需人工`);
    await out("unknown");
    process.exit(2);
  }
}
if (!w.closingDay) {
  console.log(`CLOSING-DAY: NO｜${today} 這一週沒有上課日`);
  await out("no");
  process.exit(0);
}
const tail = `本週上課日 ${w.schoolDays.map(md).join("、")}（工作日 ${w.workDays.length} 天）｜${term?.標籤 ?? "週次未知"}`;
if (w.isClosingDay) {
  console.log(`CLOSING-DAY: YES｜${today} 是本週最後一個上課日｜${tail}`);
  await out("yes");
} else {
  console.log(`CLOSING-DAY: NO｜${today} 不是收尾日（本週收尾日 ${w.closingDay}）｜${tail}`);
  await out("no");
}
