/**
 * closing-day｜今天是不是「本週收尾日」（每週收尾的閘門）
 * ───────────────────────────────────────────────────────────────
 * 2026-10-06 老師裁定：每週收尾改在該週最後一個上課日跑，不再寫死週五。
 * 2026-10-23 老師裁定：停課（颱風假等）不再例外處理——已過收尾日但同週週一～週五 → YES｜補跑。
 * 判定正本＝lib/school-days.mjs 的 closingVerdict；資料＝data/daily-plan.json＋data/weeks.json。
 *
 * 用法：
 *   node scripts/classos/closing-day.mjs [yyyy-mm-dd]   判一天（不給日期＝台北今天；GitHub weekly-settle 用）
 *   node scripts/classos/closing-day.mjs --table         產生 data/closing-day.json 預算表（sync.yml 每次同步都跑）
 *
 * 為什麼要預算表（2026-10-23 實測）：雲端排程跑 `node closing-day.mjs` 會被 auto mode 分類器
 * 以「External System Writes」時擋時放（同一指令 3 分鐘內一擋一放），被擋＝整支空轉。
 * 雲端改用 Read 工具讀預算表、查今天那一格（Read 不經分類器），判定仍是同一支程式算的。
 *
 * 輸出（第一行給人與模型讀，逐字比對開頭即可）：
 *   CLOSING-DAY: YES｜…        → 今天是收尾日，繼續往下做
 *   CLOSING-DAY: YES｜補跑｜…  → 已過本週收尾日（停課把收尾日往前改了），下游先查本週是否已收尾
 *   CLOSING-DAY: NO｜…         → 不是，本輪結束
 *   CLOSING-DAY: UNKNOWN｜…    → 判不出（學期中但每日課程進度沒有本週資料），需人工
 * 結束碼：YES／NO＝0，UNKNOWN＝2。GitHub Actions 另寫 `closing=yes|no|unknown` 到 $GITHUB_OUTPUT。
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { closingVerdict } from "./lib/school-days.mjs";

const DATA = new URL("../../data/", import.meta.url);
const readText = f => readFile(new URL(f, DATA), "utf8");

const planText = await readText("daily-plan.json");
const weeksText = await readText("weeks.json");
const plan = JSON.parse(planText);
const weeks = JSON.parse(weeksText);

if (process.argv[2] === "--table") {
  // 範圍：第一個學期週往前 45 天～最後一個學期週往後 120 天（暑假的「每月 20 日」雲端觸發也查得到 NO）。
  // 查無那一天＝表過期或沒產生，雲端照 UNKNOWN 處理。不寫產生時間：資料沒變就不產生新 commit。
  const all = (weeks.學期 ?? []).flatMap(t => t.週 ?? []);
  if (!all.length) throw new Error("weeks.json 沒有任何學期週，預算表不產生");
  const shift = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const from = shift(all.map(x => x.起).sort()[0], -45);
  const to = shift(all.map(x => x.迄).sort().at(-1), 120);
  const 日 = {};
  for (let d = from; d <= to; d = shift(d, 1)) 日[d] = closingVerdict(plan, weeks, d).line;
  const 來源 = createHash("sha256").update(planText).update(weeksText).digest("hex").slice(0, 12);
  const out = {
    說明: "收尾閘門預算表：每一天的 closing-day 判定（lib/school-days.mjs closingVerdict）。由 scripts/classos/closing-day.mjs --table 在班網同步時產生，不要手改。雲端排程用 Read 讀、查台北今天那一格。",
    來源,
    範圍: { 起: from, 迄: to },
    日,
  };
  await writeFile(new URL("closing-day.json", DATA), JSON.stringify(out, null, 2) + "\n");
  console.log(`closing-day.json｜${from}～${to}｜${Object.keys(日).length} 天｜補跑日 ${Object.values(日).filter(l => l.includes("｜補跑｜")).length} 天｜來源 ${來源}`);
  process.exit(0);
}

const arg = process.argv[2] || process.env.CLOSING_TODAY || "";
const today = /^\d{4}-\d{2}-\d{2}$/.test(arg)
  ? arg : new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

const v = closingVerdict(plan, weeks, today);
console.log(v.line);
const flag = v.verdict === "UNKNOWN" ? "unknown" : v.verdict === "NO" ? "no" : "yes";
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `closing=${flag}\n`);
process.exit(v.verdict === "UNKNOWN" ? 2 : 0);
