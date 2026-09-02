/**
 * ClassOS｜f13：把「115學年度四上每日作業進度表」批次寫進 Notion 📒 聯絡簿
 *
 * 做三件事（依 SPEC_學年升級 §3：批次寫入一律走官方 API，預設 dry-run）：
 *   1. 依「日期」比對，覆寫每個上課日的「作業」欄（格式：一行一科）
 *   2. 依「攜帶物品」的星期規則填該欄（規則留空＝清空，目前狀態）；「提醒事項」只在
 *      定期評量／休業式那幾天填，其餘清空
 *   3. **不動「發布」欄** —— 發布由 sync-notion.mjs 的「日期 ≤ 今天+7 天」規則自動放行；
 *      老師手動勾起來的「提前公開」是老師的決定，重灌內容不該把它取消掉。
 *
 * 用法：
 *   dry-run：MODE=dry-run NOTION_TOKEN=xxx node scripts/classos/f13-fill-contactbook.mjs
 *   實際寫：MODE=execute NOTION_TOKEN=xxx node scripts/classos/f13-fill-contactbook.mjs
 *   （或走 .github/workflows/classos-phase-f.yml，token 留在 GitHub Secret）
 *
 * ⚠️ repo 為 PUBLIC、Actions log 公開可讀：本腳本只印日期與統計，不印作業內容。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { queryAll, updatePage, propText, forEachThrottled, isExecute, shortId } from "./lib/notion.mjs";

const CONTACTBOOK_DS = "12825acc-e6b6-4273-afdf-a505f6b36ad3"; // 📒 聯絡簿
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "data", "115-1-contactbook.json");

const EXECUTE = isExecute();
const SUBJECTS = ["國語", "數學", "社會"];

/**
 * 一項功課一行，且**不寫科目名稱**（老師 2026-07-31 指示）：
 * 作業本身已含「國習／數習／社練」等簿本名稱，前面再加「國語　」會讓學生把科目誤看成一項功課。
 * 同一科用頓號分隔的多項（例：「國習 L1 P.4-5、甲本 L1 P.3-12」）也拆成各自一行。
 * 整天都沒有 → 空字串（前台會顯示「今天沒有功課」）。
 */
const homeworkText = (day) =>
  SUBJECTS
    .flatMap((s) => String(day[s] ?? "").split("、"))
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n");

const rt = (s) => ({ rich_text: s ? [{ text: { content: s } }] : [] });

/**
 * 攜帶物品：依星期自動帶入（正本 JSON 的「攜帶物品」欄，一行一項）。
 * 單日要例外時，在那一天的資料加 "攜帶物品" 字串即可覆蓋星期規則。
 * 兩者都沒有 → 空字串（＝清掉該欄）。
 */
const WEEKDAY = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const bringText = (day, byWeekday) => {
  if (typeof day["攜帶物品"] === "string") return day["攜帶物品"].trim();
  const wd = WEEKDAY[new Date(day.date + "T00:00:00Z").getUTCDay()];
  return (byWeekday?.[wd] ?? []).map((s) => String(s).trim()).filter(Boolean).join("\n");
};

const { days, "攜帶物品": bringByWeekday } = JSON.parse(await readFile(SRC, "utf8"));
console.log(`📄 進度表來源：${path.basename(SRC)}（${days.length} 個上課日）`);
console.log(`⚙️  模式：${EXECUTE ? "execute（實際寫入）" : "dry-run（只列不改）"}\n`);

// ── 撈 Notion 聯絡簿，依日期建索引 ──
const pages = await queryAll(CONTACTBOOK_DS);
const byDate = new Map();
for (const p of pages) {
  const d = propText(p, "日期");
  if (d) byDate.set(d, p);
}
console.log(`📒 Notion 聯絡簿共 ${pages.length} 列，其中有日期 ${byDate.size} 列`);

// ── 對帳：進度表有、Notion 沒有的日期（fail loud，不靜默略過）──
const missing = days.map((d) => d.date).filter((d) => !byDate.has(d));
if (missing.length) {
  console.error(`\n❌ 進度表有 ${missing.length} 天在 Notion 找不到對應列：\n   ${missing.join("、")}`);
  console.error("   請先確認 seed-115.mjs 建的上課日是否與進度表一致，再重跑。");
  process.exit(1);
}

// ── 對帳：學期範圍內 Notion 有、進度表沒有的日期（只警告，可能是老師自己加的）──
const planned = new Set(days.map((d) => d.date));
const inTerm = [...byDate.keys()].filter((d) => d >= "2026-08-31" && d <= "2027-01-20");
const extra = inTerm.filter((d) => !planned.has(d));
if (extra.length) console.log(`⚠️  學期內有 ${extra.length} 天不在進度表、將維持原樣：${extra.join("、")}`);

// ── 逐日規劃異動 ──
const plan = [];
for (const day of days) {
  const page = byDate.get(day.date);
  const hw = homeworkText(day);
  const note = (day["提醒事項"] ?? "").trim();
  const bring = bringText(day, bringByWeekday);
  const changes = [];
  if (propText(page, "作業") !== hw) changes.push("作業");
  if (propText(page, "攜帶物品") !== bring) changes.push(bring ? "攜帶物品" : "清攜帶物品");
  if (propText(page, "提醒事項") !== note) changes.push(note ? "提醒事項" : "清提醒事項");
  if (changes.length) plan.push({ date: day.date, id: page.id, hw, note, bring, changes });
}

console.log(`\n📝 需異動 ${plan.length} 天（共 ${days.length} 天）：`);
for (const p of plan) console.log(`   ${p.date}  [${shortId(p.id)}]  ${p.changes.join("／")}`);

if (!EXECUTE) {
  console.log("\n✅ dry-run 結束，未寫入任何資料。要實際寫入請帶 MODE=execute。");
  process.exit(0);
}

// ── 實際寫入 ──
const { ok, fail } = await forEachThrottled(plan, (p) =>
  updatePage(p.id, {
    "作業": rt(p.hw),
    "攜帶物品": rt(p.bring),
    "提醒事項": rt(p.note),
  }));

console.log(`\n✅ 成功 ${ok.length} 筆／❌ 失敗 ${fail.length} 筆`);
if (fail.length) {
  for (const f of fail) console.error(`   ${f.item.date} → ${f.error ?? f.r?.json?.message ?? "未知錯誤"}`);
  process.exit(1);
}
console.log("聯絡簿內容已寫入（未更動「發布」欄），由『前一週自動發布』規則接手上站。");
