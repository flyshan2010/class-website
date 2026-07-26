/**
 * ClassOS Phase F｜F11：學年升級精靈（SPEC_學年升級 §9）
 *
 * 精靈實際寫入的只有兩個庫：👥 學生名冊、⚙️ 網站設定。
 * 其餘 10 庫**刻意不碰**——舊列的 `學年` 已是舊值，班網同步的學年過濾會自動把它們
 * 排除在外（封存不刪除）。少寫 = 少錯，這是設計，不是遺漏。
 *
 * 環境變數：
 *   TARGET      sandbox | production   （預設 sandbox，正式庫要明講）
 *   MODE        dry-run | execute      （預設 dry-run）
 *   PATH_MODE   auto | A | B           （預設 auto，由年級推導）
 *   NEW_CLASS   新班級名稱             （路徑 B 必填；路徑 A 可留空自動推算）
 *   BACKUP_DONE yes | no               （TARGET=production 且 MODE=execute 時必須為 yes）
 */

import { DS, queryAll, propText, updatePage, forEachThrottled, isExecute } from "./lib/notion.mjs";
import { findSandboxPage, sandboxDataSources } from "./lib/sandbox.mjs";

const TARGET = (process.env.TARGET ?? "sandbox").trim();
const EXECUTE = isExecute();
const PATH_MODE = (process.env.PATH_MODE ?? "auto").trim();
const NEW_CLASS = (process.env.NEW_CLASS ?? "").trim();
const BACKUP_DONE = (process.env.BACKUP_DONE ?? "no").trim() === "yes";

const GRADES = ["一", "二", "三", "四", "五", "六"];
const gradeNum = ch => GRADES.indexOf(ch) + 1;          // 「四」→ 4
const gradeChar = n => GRADES[n - 1] ?? null;
// 帶班週期：一二／三四／五六 ⇒ 二、四、六年級升上去就是「週期交界」，整批換學生
const isBoundary = g => g % 2 === 0;

console.log(`═══ ClassOS 學年升級精靈 ═══`);
console.log(`對象：${TARGET === "production" ? "⚠️ 正式庫" : "🧪 沙盒"}｜模式：${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}\n`);

// ── 步驟 1：解析目標資料庫 ───────────────────────────
let rosterDs, settingsDs;
if (TARGET === "production") {
  rosterDs = DS.roster; settingsDs = DS.settings;
} else {
  const page = await findSandboxPage();
  if (!page) { console.log("❌ 找不到沙盒，請先跑 f10-sandbox（MODE=execute）建立"); process.exit(1); }
  const dbs = await sandboxDataSources(page);
  rosterDs = dbs["👥 學生名冊（沙盒）"]?.dataSourceId;
  settingsDs = dbs["⚙️ 網站設定（沙盒）"]?.dataSourceId;
  if (!rosterDs || !settingsDs) { console.log("❌ 沙盒缺少必要資料庫，請重建"); process.exit(1); }
}

// ── 步驟 2：讀現況並判定路徑 ─────────────────────────
const settingRows = await queryAll(settingsDs);
const kv = {};
for (const r of settingRows) {
  const k = propText(r, "項目"); if (k) kv[k] = { text: propText(r, "內容"), id: r.id };
}
const yearRaw = kv["學年度"]?.text ?? "";
const classRaw = kv["班級"]?.text ?? "";
const curYear = Number((yearRaw.match(/\d{3}/) ?? [])[0]);
const curGrade = gradeNum(classRaw[0]);

if (!curYear) { console.log(`❌ 網站設定讀不到「學年度」（值：${yearRaw || "空"}），中止`); process.exit(1); }
if (!curGrade) { console.log(`❌ 網站設定的「班級」無法解析年級（值：${classRaw || "空"}），中止`); process.exit(1); }

const newYear = curYear + 1;
const newGrade = curGrade + 1;
const autoPath = isBoundary(curGrade) ? "B" : "A";
const pathId = PATH_MODE === "auto" ? autoPath : PATH_MODE;

console.log(`現況：${yearRaw}｜${classRaw}（${curGrade} 年級）`);
console.log(`升級後：${newYear}學年度｜${newGrade > 6 ? "畢業" : `${gradeChar(newGrade)} 年級`}`);
console.log(`路徑判定：**${pathId}**（${pathId === "B" ? "週期交界 — 整批換學生" : "週期內 — 同一批學生升一級"}）` +
  `${PATH_MODE === "auto" ? "" : "　※ 由參數指定，非自動判定"}`);
if (newGrade > 6) console.log(`⚠️ 六年級升上去＝畢業，本精靈只處理封存與設定，不建新班`);

// 路徑 A 的新班名可推算；路徑 B 是全新班級，不猜
const newClass = pathId === "A"
  ? (NEW_CLASS || `${gradeChar(newGrade)}年${classRaw.slice(2)}`)
  : NEW_CLASS;

// ── 步驟 3：產出變更清單（SPEC §9 步驟 3）──────────────
const roster = await queryAll(rosterDs);
const enrolled = roster.filter(r => propText(r, "在學") === "true");
const notEnrolled = roster.length - enrolled.length;

console.log(`\n───── 變更清單 ─────`);
console.log(`👥 學生名冊：全庫 ${roster.length} 列，在學 ${enrolled.length} 列，非在學 ${notEnrolled} 列（不動）`);

const changes = [];
if (pathId === "A") {
  console.log(`\n【A-1】在學 ${enrolled.length} 列：學年 ${curYear} → ${newYear}（**查詢碼與在學狀態不動**，家長沿用原碼）`);
  for (const r of enrolled) changes.push({ id: r.id, label: `座號 ${propText(r, "座號")}`, props: { 學年: { select: { name: String(newYear) } } } });
} else {
  console.log(`\n【B-1】在學 ${enrolled.length} 列：在學 ✅→⬜（學年維持 ${curYear} 不動，靠學年值封存）`);
  console.log(`      ⇒ 下次班網同步後，這些座號的報告 json 不再產出，**舊查詢碼即刻失效**`);
  for (const r of enrolled) changes.push({ id: r.id, label: `座號 ${propText(r, "座號")}`, props: { 在學: { checkbox: false } } });
}
console.log(`      受影響座號：${enrolled.map(r => propText(r, "座號")).join("、") || "（無）"}`);

console.log(`\n【${pathId}-2】⚙️ 網站設定：`);
console.log(`      學年度：${yearRaw} → ${newYear}學年度`);
if (kv["學年度"]) changes.push({ id: kv["學年度"].id, label: "設定・學年度", props: { 內容: { rich_text: [{ text: { content: `${newYear}學年度` } }] } } });
else console.log(`      ⚠️ 設定中沒有「學年度」列，無法更新`);

if (newClass) {
  console.log(`      班級：${classRaw} → ${newClass}`);
  if (kv["班級"]) changes.push({ id: kv["班級"].id, label: "設定・班級", props: { 內容: { rich_text: [{ text: { content: newClass } }] } } });
} else {
  console.log(`      班級：${classRaw} → **未指定**（路徑 B 為全新班級，精靈不猜；請以 NEW_CLASS 傳入）`);
}

console.log(`\n【不動的部分】其餘 10 庫（紀錄／成績／帳本／兌換／輔導／作品／報告／週報／收件匣／教學單元）`);
console.log(`      舊列 學年＝${curYear} 原地保留，班網同步的學年過濾會自動排除 ⇒ **封存不刪除**`);
if (pathId === "B") console.log(`\n【需老師手動】新班名冊匯入（新座號／姓名／查詢碼／學年=${newYear}）——精靈不代勞，避免造出假學生`);
console.log(`\n【升級後必做】跑一次班網同步，確認站上只剩 ${newYear} 學年資料`);
console.log(`【提醒】🏦 班級銀行帳本同樣受學年過濾 ⇒ 升級後餘額歸零重算，升級前務必先結清`);

console.log(`\n合計待寫入 ${changes.length} 筆`);

// ── 步驟 4：把關（SPEC §9 步驟 2／4）───────────────────
if (!EXECUTE) {
  console.log(`\n🔍 DRY-RUN 結束，未異動任何資料。`);
  console.log(`   確認上列清單無誤後，以 MODE=execute 重跑。`);
  if (TARGET === "production") console.log(`   正式庫另需 BACKUP_DONE=yes（Notion 全庫匯出備份已完成）。`);
  process.exit(0);
}
if (TARGET === "production" && !BACKUP_DONE) {
  console.log(`\n❌ 中止：正式庫升級前必須先做 Notion 全庫匯出備份（SPEC §7 硬前提）。`);
  console.log(`   備份完成後，以 BACKUP_DONE=yes 重跑。**無備份不得執行升級。**`);
  process.exit(1);
}
if (pathId === "B" && !newClass) {
  console.log(`\n❌ 中止：路徑 B 必須指定 NEW_CLASS（新班級名稱）。`);
  process.exit(1);
}

// ── 步驟 5：執行 ────────────────────────────────────
console.log(`\n開始執行…\n`);
const { ok, fail } = await forEachThrottled(changes, c => updatePage(c.id, c.props));
console.log(`  成功 ${ok.length}／失敗 ${fail.length}`);
for (const f of fail) console.log(`    ❌ ${f.item.label} — ${f.error ?? `HTTP ${f.r?.status} ${f.r?.json?.code ?? ""}`}`);

// ── 步驟 6：回讀驗證（SPEC §9 步驟 6）──────────────────
console.log(`\n回讀驗證…`);
const roster2 = await queryAll(rosterDs);
const settings2 = await queryAll(settingsDs);
const kv2 = {};
for (const r of settings2) { const k = propText(r, "項目"); if (k) kv2[k] = propText(r, "內容"); }

const checks = [];
if (pathId === "A") {
  const stillOld = roster2.filter(r => propText(r, "在學") === "true" && propText(r, "學年") !== String(newYear));
  const codesKept = roster2.filter(r => propText(r, "在學") === "true").every(r => String(propText(r, "查詢碼")).trim() !== "");
  checks.push([`在學列學年皆為 ${newYear}`, stillOld.length === 0, `尚有 ${stillOld.length} 列未更新`]);
  checks.push([`查詢碼全部保留（家長沿用原碼）`, codesKept, `有列的查詢碼遺失`]);
} else {
  const stillEnrolled = roster2.filter(r => propText(r, "在學") === "true");
  const yearKept = roster2.every(r => propText(r, "學年") === String(curYear));
  checks.push([`舊名冊已全數取消在學`, stillEnrolled.length === 0, `尚有 ${stillEnrolled.length} 列在學`]);
  checks.push([`舊名冊學年維持 ${curYear}（封存不刪除）`, yearKept, `有列的學年被改動`]);
}
checks.push([`設定・學年度＝${newYear}學年度`, kv2["學年度"] === `${newYear}學年度`, `實際為「${kv2["學年度"]}」`]);
if (newClass) checks.push([`設定・班級＝${newClass}`, kv2["班級"] === newClass, `實際為「${kv2["班級"]}」`]);

let bad = 0;
for (const [label, pass, why] of checks) { if (!pass) bad++; console.log(`  ${pass ? "✅" : "❌"} ${label}${pass ? "" : ` — ${why}`}`); }

console.log(`\n════════ 總結 ════════`);
if (!fail.length && !bad) {
  console.log(`結論：路徑 ${pathId} 升級完成（${TARGET === "production" ? "正式庫" : "沙盒"}），${ok.length} 筆寫入全部回讀通過。`);
  console.log(`下一步：跑一次班網同步，確認站上只剩 ${newYear} 學年資料。`);
  if (pathId === "B") console.log(`      另需匯入新班名冊，並把舊班資料匯出存 Drive 歸檔。`);
} else {
  console.log(`結論：未完全成功（寫入失敗 ${fail.length}、回讀不合格 ${bad}），請檢查後處理。`);
  process.exit(1);
}
