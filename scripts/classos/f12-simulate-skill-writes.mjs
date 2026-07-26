/**
 * ClassOS Phase F｜F12：9 支 skill 學年寫入模擬（SPEC §10 驗收第 7 項）
 *
 * 為什麼要模擬而不是直接實測正式庫：
 *   實測要 9 支 skill 各在正式庫產一列，等於再造 9 筆假資料。
 *   Phase A 的教訓就是「驗收資料寫進正式庫，清不掉」。故先在沙盒模擬。
 *
 * 這個測試在測什麼：
 *   每支 skill 的 SKILL.md 都指定了「學年取自哪個欄位」。本腳本把該規則套用到
 *   **一個刻意刁鑽的補登情境**，算出學年、寫進沙盒 select 欄、再回讀比對預期值。
 *
 *   ⭐ 所有預期答案都刻意設計成 **≠ 今天所屬的學年**。
 *      因此只要有一支的規則被誤解成「用今天算」，該支就會當場 FAIL。
 *
 * 這個測試**不能**證明什麼（誠實聲明）：
 *   它驗證的是「規則本身算得對、值寫得進去」，不是「執行期的 Sonnet 一定會照做」。
 *   後者只能靠開學後真實使用時逐支觀察。
 */

import { queryAll, propText, apiOrThrow, isExecute } from "./lib/notion.mjs";
import { academicYear } from "./lib/academic-year.mjs";
import { findSandboxPage, sandboxDataSources } from "./lib/sandbox.mjs";

const EXECUTE = isExecute();
const DB = "🧪 模擬寫入（沙盒）";

/** 由「學期名稱」取學年：`115上第九週(10/26-10/30)` → 115 */
const fromTermName = s => {
  const m = String(s).match(/\d{3}/);
  if (!m) throw new Error(`取不到學年：${s}`);
  return Number(m[0]);
};

/**
 * 9 支 skill 的測試案例。
 * rule＝該 skill 的 SKILL.md 明定的取值方式；情境一律選「最容易用今天算錯」的那種。
 */
const CASES = [
  { skill: "class-log",         情境: "開學後補登 9/15 的課堂事件", 來源: "日期 2026-09-15",              rule: () => academicYear("2026-09-15"), 預期: 115 },
  { skill: "class-grades",      情境: "暑假補匯下學期成績",         來源: "學期「115下」",                rule: () => fromTermName("115下"),      預期: 115 },
  { skill: "class-bank",        情境: "週結補結 1 月的帳（1月屬上學期）", 來源: "日期 2027-01-15",         rule: () => academicYear("2027-01-15"), 預期: 115 },
  { skill: "class-counsel",     情境: "補登 9 月開案的舊個案",       來源: "開始日期 2026-09-01",          rule: () => academicYear("2026-09-01"), 預期: 115 },
  { skill: "class-portfolio",   情境: "遲交作品事後補建",           來源: "日期 2027-02-01",              rule: () => academicYear("2027-02-01"), 預期: 115 },
  { skill: "class-report",      情境: "補產舊週的學習報告",         來源: "期間「115上第九週(10/26-10/30)」", rule: () => fromTermName("115上第九週(10/26-10/30)"), 預期: 115 },
  { skill: "class-term-report",情境: "暑假產上一學期的總報告",     來源: "期間「115下學期總報告」",      rule: () => fromTermName("115下學期總報告"), 預期: 115 },
  { skill: "class-weekly",      情境: "補產新學年的週報",           來源: "週次「116上第三週(9/14-9/18)」", rule: () => fromTermName("116上第三週(9/14-9/18)"), 預期: 116 },
  { skill: "lesson-flow",       情境: "暑假備下一學年的課",         來源: "日期 2027-09-01（預定授課日）", rule: () => academicYear("2027-09-01"), 預期: 116 },
];

// 今天所屬學年——所有預期值都應與它不同，這樣「用今天算」的錯誤才會被抓到
const todayYear = academicYear(new Date());

console.log(`模式：${EXECUTE ? "⚠️ EXECUTE（寫入沙盒）" : "🔍 DRY-RUN（只算不寫）"}`);
console.log(`今天所屬學年＝${todayYear}　←　所有預期值都刻意與它不同\n`);

// ── 先純算，不碰 Notion ─────────────────────────────
console.log("步驟 1／規則計算（不寫入任何資料）");
console.log("skill".padEnd(19) + "情境".padEnd(26) + "算出".padEnd(7) + "預期".padEnd(7) + "與今天不同");
console.log("─".repeat(78));
let calcFail = 0;
for (const c of CASES) {
  try { c.算出 = c.rule(); } catch (e) { c.算出 = null; c.err = e.message; }
  c.ok = c.算出 === c.預期;
  c.discriminating = c.預期 !== todayYear;
  if (!c.ok || !c.discriminating) calcFail++;
  const pad = (s, n) => String(s) + " ".repeat(Math.max(1, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(pad(c.skill, 19) + pad(c.情境, 26) + pad(c.算出 ?? "錯誤", 7) + pad(c.預期, 7) + (c.discriminating ? "✅" : "⚠️ 無鑑別力") + (c.ok ? "" : `  ❌ ${c.err ?? "不符"}`));
}
console.log("─".repeat(78));
console.log(`${CASES.length - calcFail}/${CASES.length} 通過\n`);

if (!EXECUTE) {
  console.log("🔍 DRY-RUN 結束，未寫入任何資料。");
  console.log("   以 MODE=execute 重跑，會把 9 筆寫進沙盒的 select 欄並回讀比對（需先建好沙盒）。");
  process.exit(calcFail ? 1 : 0);
}

// ── 寫進沙盒並回讀 ──────────────────────────────────
const page = await findSandboxPage();
if (!page) { console.log("❌ 找不到沙盒，請先跑 f10-sandbox（MODE=execute）"); process.exit(1); }
const dbs = await sandboxDataSources(page);
const ds = dbs[DB]?.dataSourceId;
if (!ds) { console.log(`❌ 沙盒缺少「${DB}」，請先拆除沙盒再重建（f10 跑兩次）`); process.exit(1); }

console.log("步驟 2／寫入沙盒 select 欄並回讀\n");
for (const c of CASES) {
  await apiOrThrow("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: ds },
    properties: {
      情境:    { title: [{ text: { content: `${c.skill}｜${c.情境}` } }] },
      skill:   { rich_text: [{ text: { content: c.skill } }] },
      來源值:  { rich_text: [{ text: { content: c.來源 } }] },
      預期學年: { rich_text: [{ text: { content: String(c.預期) } }] },
      學年:    { select: { name: String(c.算出) } },
    },
  });
}

const rows = await queryAll(ds);
let bad = 0;
for (const c of CASES) {
  const row = rows.find(r => propText(r, "skill") === c.skill);
  const actual = row ? propText(row, "學年") : null;
  const expect = String(c.預期);
  const pass = actual === expect;
  if (!pass) bad++;
  console.log(`  ${pass ? "✅" : "❌"} ${c.skill.padEnd(18)} 回讀學年=${actual ?? "（無）"}　預期=${expect}　來源：${c.來源}`);
}

console.log(`\n════════ 總結 ════════`);
console.log(`規則計算 ${CASES.length - calcFail}/${CASES.length}　沙盒回讀 ${CASES.length - bad}/${CASES.length}`);
if (!calcFail && !bad) {
  console.log(`結論：9 支 skill 的學年規則在補登情境下全部算對，且值能正確寫入 select 欄。`);
  console.log(`      所有預期值皆 ≠ 今天所屬學年（${todayYear}），故「用今天算」的錯誤不可能矇混通過。`);
  console.log(`      ⚠️ 仍未證明：執行期的 Sonnet 一定會照規則做——這只能靠開學後真實使用觀察。`);
} else {
  console.log(`結論：有項目未通過，需修正對應 skill 的規則敘述。`);
  process.exit(1);
}
