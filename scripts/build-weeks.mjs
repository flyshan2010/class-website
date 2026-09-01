/**
 * 學校週次對照表：data/calendar.json →  data/weeks.json（零相依，Node 18+）
 *
 * 為什麼要有這張表：
 *   在此之前，「今天是第幾週」是每支 skill 各自現推的——同一天在三個地方被算成
 *   「四上第1週」「115上第一週」「上學期第一週」三種字串，週結與學習報告用
 *   `WHERE 週次 = ?` 對字串比對，一漂就整批查不到。這支腳本讓週次只有一個出處。
 *
 * 演算法（與 Notion「📰 班級週報」既有 42 列逐字相符，改動前請先跑 --check）：
 *   - 學期起訖 = calendar.json 的「開學」事件 → 其後最近一個「休業式」事件。
 *   - 第 1 週 = 開學日所在的那個曆週；之後每 7 天一週。
 *   - 標籤日期 = 該週的週一～週五，並在學期頭尾裁切到開學日／休業日
 *     （所以 115 下第一週是 2/11-2/12，不是 2/8-2/12）。
 *   - 查表區間（起／迄）用週一～週日，週末的日期才不會查不到週次。
 *   - 假期（不在任何學期區間內）→ 查無週次，各 skill 依規則把週次留空。
 *
 * 預排日（2026-09-01 老師裁示，不要「修正」成別的算法）：
 *   daily-plan.json 偶爾會有落在學期區間外的上課日——例如 2027-01-21、01-22，
 *   在休業式（1/20）之後、下學期開學（2/11）之前。那是老師的**預排緩衝**：
 *   曾發生下學期課程提前上，所以先把那幾天排出來備用。
 *   **學期起訖仍以 Google 日曆為準**（休業式 1/20、寒假 1/21 起，115 上就是 21 週），
 *   但這些天真的用到時上的是下學期的課，所以**一律歸「下一個學期的第 1 週」**
 *   （1/21、1/22 → 四下第1週）。它們寫在該週的 `預排日` 陣列，查表時要一併比對。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const 中文數字 = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

const toISO = d => d.toISOString().slice(0, 10);
const parse = s => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const md = s => { const [, m, d] = s.split("-"); return `${+m}/${+d}`; };

// 1→一、11→十一、21→二十一（週次最多到 22 週，不必處理百位）
function 中文序(n) {
  if (n <= 10) return 中文數字[n];
  if (n < 20) return `十${中文數字[n - 10]}`;
  const 十位 = Math.floor(n / 10), 個位 = n % 10;
  return `${中文數字[十位]}十${個位 ? 中文數字[個位] : ""}`;
}

// 學年 = 西元年 - 1911 - (月 < 8 ? 1 : 0)（全系統共用，見 RULE_學年欄位.md）
const 學年of = iso => {
  const [y, m] = iso.split("-").map(Number);
  return String(y - 1911 - (m < 8 ? 1 : 0));
};

// 115 學年＝四年級（入學那年 111）。超出國小六年就退回學年數字當前綴，不硬掰。
function 學期名(開學日) {
  const 學年 = 學年of(開學日);
  const 上下 = Number(開學日.split("-")[1]) >= 8 ? "上" : "下";
  const 年級 = Number(學年) - 111;
  const 前綴 = 年級 >= 1 && 年級 <= 6 ? 中文數字[年級] : 學年;
  return { 學年, 上下, 學期名稱: `${前綴}${上下}` };
}

function 建學期(開學日, 休業日) {
  const { 學年, 上下, 學期名稱 } = 學期名(開學日);
  const 開學 = parse(開學日), 休業 = parse(休業日);
  // 回推到開學日所在曆週的星期一（getUTCDay: 0=日）
  const 週一 = addDays(開學, -((開學.getUTCDay() + 6) % 7));
  const 週 = [];
  for (let i = 0; ; i++) {
    const mon = addDays(週一, i * 7);
    if (mon > 休業) break;
    const sun = addDays(mon, 6);
    const 上課起 = mon < 開學 ? 開學 : mon;
    let 上課迄 = addDays(mon, 4);          // 週五
    if (上課迄 > 休業) 上課迄 = 休業;
    const n = i + 1;
    const 區間 = `(${md(toISO(上課起))}-${md(toISO(上課迄))})`;
    週.push({
      週次: n,
      起: toISO(mon < 開學 ? 開學 : mon),   // 查表用（含週末）
      迄: toISO(sun > 休業 ? 休業 : sun),
      上課起: toISO(上課起),
      上課迄: toISO(上課迄),
      標籤: `${學期名稱}第${n}週${區間}`,
      別名: [`${學期名稱}第${中文序(n)}週${區間}`, `${學年}${上下}第${中文序(n)}週${區間}`],
    });
  }
  return { 學年, 學期: 上下, 學期名稱, 開學日, 休業日, 週數: 週.length, 週 };
}

const events = JSON.parse(await readFile(path.join(DATA_DIR, "calendar.json"), "utf8"));
const 開學們 = events.filter(e => e.title?.trim() === "開學").map(e => e.date).sort();
const 休業們 = events.filter(e => e.title?.includes("休業式")).map(e => e.date).sort();

const 學期們 = 開學們
  .map(s => [s, 休業們.find(e => e > s)])
  .filter(([, e]) => e)
  .map(([s, e]) => 建學期(s, e));

/* 預排日：daily-plan.json 裡落在所有學期區間外的上課日（老師的緩衝日）。
   歸「下一個學期的第 1 週」——真的用到時上的是下學期的課。
   daily-plan.json 由 sync-notion 產生、排在本腳本之前；讀不到就當作沒有預排日。 */
let 上課日們 = [];
try {
  const dp = JSON.parse(await readFile(path.join(DATA_DIR, "daily-plan.json"), "utf8"));
  上課日們 = (dp.days || []).filter(d => d.date && d.holiday === false).map(d => d.date);
} catch { /* 沒有 daily-plan.json 就跳過 */ }

for (const iso of 上課日們) {
  if (學期們.some(sm => iso >= sm.開學日 && iso <= sm.休業日)) continue;   // 已在某學期內
  const 下個 = 學期們.find(sm => sm.開學日 > iso);
  if (!下個) continue;                                                     // 沒有下一個學期就不歸
  (下個.週[0].預排日 ||= []).push(iso);
}
for (const sm of 學期們) if (sm.週[0].預排日) sm.週[0].預排日.sort();

if (!學期們.length) {
  console.warn("⚠️ calendar.json 找不到「開學」＋「休業式」配對，weeks.json 未更新");
  process.exit(0);
}

const out = {
  _說明: "學校週次對照表。由 build-weeks.mjs 從 data/calendar.json 的開學／休業式推算，請勿手改；"
       + "要調整週次請改 Google 日曆的開學／休業式日期後重跑同步。日期不在任何學期區間內＝假期，週次留空；但要先比對各週的『預排日』（老師的緩衝上課日，歸下一學期第 1 週）。",
  格式: "{學期名稱}第N週(M/D-M/D)，N 用阿拉伯數字；別名收錄國字寫法供舊資料比對",
  來源: "data/calendar.json（開學／線上休業式）",
  學期: 學期們,
};

// --check：與 Notion「📰 班級週報」既有列逐字比對用，只印不寫檔
if (process.argv.includes("--check")) {
  for (const s of 學期們) for (const w of s.週) console.log(`${w.別名[0]}\t${w.上課起} ~ ${w.上課迄}`);
  process.exit(0);
}

await writeFile(path.join(DATA_DIR, "weeks.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`✅ weeks.json（${學期們.map(s => `${s.學期名稱} ${s.週數} 週`).join("、")}）`);
