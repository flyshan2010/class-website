/**
 * f32｜某一週的學習報告「發布」勾選（week-publish §3）
 * ───────────────────────────────────────────────────────────────
 * 背景（2026-09-18）：勾發布原本是 Claude Code 用 MCP 逐列 update，27 列就是 27 次呼叫，
 *   而發布前那幾項檢查（份數、空欄、學年、姓名對名冊）全靠模型自己看——看漏一格，
 *   家長就會在班網上看到一份缺角的報告。
 *
 * 本腳本把檢查做成機器判定：**任一項不通過就整批不勾**（week-publish §3-3 的「有一份不過就整批不勾」）。
 *   判不準的（等第乙以下說不說得出依據）不寫進來，只把名單印出來交人工看。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f32-publish-week-reports
 *       week=四上第3週(9/14-9/18)（必填，逐字等於報告列的「期間」）
 *       mode=dry-run（預設，只檢查不勾）／execute（通過才勾發布）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印座號，不印姓名與報告內文。
 */
import { queryAll, api, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";

const WEEK = String(process.env.WEEK_LABEL || "").trim();
if (!WEEK) {
  console.error("❌ 缺少 week（週次標籤）。例：四上第3週(9/14-9/18)");
  process.exit(1);
}

const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const num = (p, k) => p.properties?.[k]?.number;
const relIds = (page, name) => (page.properties?.[name]?.relation ?? []).map(r => r.id);

console.log(`🎯 週次 ${WEEK}｜模式 ${isExecute() ? "execute（通過才勾發布）" : "dry-run（只檢查不勾）"}`);

// ── 名冊（份數與姓名比對的基準）─────────────────────────────────
const roster = (await queryAll(DS.roster))
  .filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: p.properties?.["座號"]?.number, name: anyText(p, "姓名") }))
  .filter(r => Number.isFinite(r.seat));
const rosterBySeat = new Map(roster.map(r => [r.seat, r]));
console.log(`👥 在學名冊 ${roster.length} 人`);

// ── 本週的「每週」報告 ──────────────────────────────────────────
const reports = (await queryAll(DS.reports)).filter(p =>
  anyText(p, "期間") === WEEK && sel(p, "報告類型") === "每週");
console.log(`📊 ${WEEK} 每週報告 ${reports.length} 份（已勾發布 ${reports.filter(p => p.properties?.["發布"]?.checkbox).length} 份）`);

// ── 發布前檢查（任一項不過 → 整批不勾）──────────────────────────
/* 必填欄＝班網報告頁真的會渲染的那些。少一格前端不會報錯，只是那一區空白——
   家長看到的就是一份缺角的報告，所以這裡寧可擋下來。 */
const REQUIRED_TEXT = [
  "國語狀態", "國語建議", "數學狀態", "數學建議", "社會狀態", "社會建議",
  "生活技能狀態", "生活技能建議", "人際互動狀態", "人際互動建議",
  "學生亮點", "家長協助建議", "短期目標",
];
const REQUIRED_NUM = [
  "國語分數", "數學分數", "社會分數", "生活技能分數", "人際互動分數", "依據紀錄數",
];
const REQUIRED_SELECT = ["生活常規", "上課參與", "作業成績", "內容評量"];

const problems = [];
const lowGrade = [];
const seen = new Set();
for (const p of reports) {
  const seat = num(p, "座號");
  const tag = Number.isFinite(seat) ? `座號${seat}` : `無座號列(${p.id.slice(0, 8)})`;
  if (!Number.isFinite(seat)) { problems.push(`${tag}：座號為空`); continue; }
  if (seen.has(seat)) problems.push(`${tag}：同一週有兩份報告`);
  seen.add(seat);

  const r = rosterBySeat.get(seat);
  if (!r) { problems.push(`${tag}：不在在學名冊`); continue; }
  // 姓名逐字比對（title 格式「01 王小明」）——比對結果只印座號，不印姓名
  const title = anyText(p, "學生");
  if (r.name && !title.includes(r.name)) problems.push(`${tag}：標題姓名與名冊不符`);
  if (!sel(p, "學年")) problems.push(`${tag}：學年為空`);
  if (!relIds(p, "學生檔案").length) problems.push(`${tag}：學生檔案 relation 為空`);

  for (const k of REQUIRED_TEXT)   if (!anyText(p, k).trim()) problems.push(`${tag}：「${k}」空白`);
  for (const k of REQUIRED_NUM)    if (!Number.isFinite(num(p, k))) problems.push(`${tag}：「${k}」空白`);
  for (const k of REQUIRED_SELECT) if (!sel(p, k)) problems.push(`${tag}：「${k}」空白`);

  for (const k of REQUIRED_SELECT) {
    const g = sel(p, k);
    if (g === "乙" || g === "丙") lowGrade.push(`${tag} ${k}＝${g}`);
  }
}
if (reports.length !== roster.length) {
  problems.push(`份數 ${reports.length} ≠ 在學人數 ${roster.length}`);
  const missing = roster.map(r => r.seat).filter(s => !seen.has(s));
  if (missing.length) problems.push(`缺報告的座號：${missing.join("、")}`);
}

console.log(`\n🔎 檢查：問題 ${problems.length} 項`);
for (const m of problems.slice(0, 40)) console.log(`   ❌ ${m}`);
if (problems.length > 40) console.log(`   …（其餘 ${problems.length - 40} 項略）`);
console.log(`🟡 等第乙以下（機器判不了依據夠不夠，請人工看）：${lowGrade.length ? lowGrade.join("、") : "無"}`);

if (problems.length) {
  console.error("\n⛔ 有一份不過就整批不勾（week-publish §3-3）。請先修好上列問題。");
  process.exit(1);
}

const todo = reports.filter(p => !p.properties?.["發布"]?.checkbox);
console.log(`\n📊 檢查全過｜待勾發布 ${todo.length} 份（已勾 ${reports.length - todo.length} 份）`);
if (!todo.length) { console.log("✅ 全部都已勾發布，結束。"); process.exit(0); }
if (!isExecute()) { console.log("\n🔍 dry-run：未勾任何一份（要勾請用 mode=execute）"); process.exit(0); }

// ── 勾發布 ─────────────────────────────────────────────────────
let ok = 0, fail = 0;
await forEachThrottled(todo, async p => {
  const res = await api("PATCH", `/pages/${p.id}`, { properties: { "發布": { checkbox: true } } });
  if (res.ok && res.json?.id) ok++;
  else { fail++; console.error(`   ❌ 座號${num(p, "座號")} 勾選失敗（HTTP ${res.status} ${res.json?.code ?? ""}）`); }
});
console.log(`\n✍️ 勾選完成：成功 ${ok} 份／失敗 ${fail} 份`);

// ── 回讀 ───────────────────────────────────────────────────────
const after = (await queryAll(DS.reports)).filter(p =>
  anyText(p, "期間") === WEEK && sel(p, "報告類型") === "每週");
const published = after.filter(p => p.properties?.["發布"]?.checkbox);
console.log(`🔁 回讀：${WEEK} 每週報告 ${after.length} 份｜已勾發布 ${published.length} 份`);
if (published.length !== after.length || after.length !== roster.length) {
  console.error("❌ 回讀不通過：勾選份數與在學人數對不上，請人工檢查。");
  process.exit(1);
}
console.log("✅ 回讀通過。");
