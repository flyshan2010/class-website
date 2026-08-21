/**
 * f20｜每日課程進度：xlsx 產物 → Notion「📅 每日課程進度」一次性遷移
 * ───────────────────────────────────────────────────────────────
 * 背景：進度原本存在 xlsx，改一次要重跑 build-daily-plan.py 再 push，老師改不動；
 *       而「這節對應哪份教材」也從來不是欄位，是 cockpit.js 每次開頁用正則猜文字，
 *       全學期 277 格有 144 格猜不出來（＝畫面上永遠掛不上教材）。
 *       本腳本把兩件事一起解決：進度搬進 Notion，對應單元變成 relation 欄位。
 *
 * 一列＝一個上課日（105 列），欄位對齊原 xlsx：
 *   日期(title) 上課日(date) 週次 放假 重要行事 / 國語進度 國語單元(relation) / 數學… / 社會…
 *
 * relation 預填：能確定的直接填，只能推測的也填但列進「需老師覆核」清單；
 * 教材尚未建立的課次（下學期的國L8~L12 等）留空 —— cockpit.js 保留正則 fallback，
 * 之後 lesson-flow 一建好單元列就會自動掛上，不必回頭補這裡。
 *
 * 冪等：已存在同一「上課日」的列會跳過，重跑不會產生重複列。
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f20-import-daily-plan
 *       mode=dry-run（預設，只列不寫）／execute（實際建列）
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, queryAll, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";
import { academicYearValue } from "./lib/academic-year.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUBJECTS = ["國語", "數學", "社會"];
const DOW_CN = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnNum = s => (/^\d+$/.test(s) ? Number(s)
  : s.length === 1 ? CN[s] || 0
  : s[0] === "十" ? 10 + (CN[s[1]] || 0)
  : (CN[s[0]] || 0) * 10 + (CN[s[2]] || 0));

// 單元標題 → 課次代碼（與 cockpit.js 同一條正則，改了要兩邊一起改）
const CODE_RE = /(?:^|\s)((?:國|數|社|自|英|健康|藝|綜)[A-Za-z]*\d+(?:-\d+)*[A-Za-z]?|SEL\d+(?:-\d+)*)(?=\s|$)/;

/** 逐日進度文字 → 課次代碼。sure=false 代表靠順序或關鍵字推測，需老師覆核。 */
function guessCode(subject, text, idx, weekEntries, hasCode) {
  const t = text || "";
  if (subject === "國語") {
    const c = /第([一二三四五六七八九十]+)課/.exec(t);
    const d = /週([一二三四五])[：:]/.exec(t);
    // 「週五」是課後評量與驗收，教材沿用第四節（綜合整理內含評量卷）
    if (c && d) return { code: `國L${cnNum(c[1])}-${{ 一: 1, 二: 2, 三: 3, 四: 4, 五: 4 }[d[1]]}`, sure: true };
    if (c) {
      // 沒寫「週N：」時，用該課在本週出現的第幾筆推第幾節（第 5 筆以上沿用第四節）
      const same = weekEntries.filter(e => (/第([一二三四五六七八九十]+)課/.exec(e.text) || [])[1] === c[1]);
      const n = same.indexOf(weekEntries[idx]);
      return { code: `國L${cnNum(c[1])}-${Math.min(n + 1, 4)}`, sure: false };
    }
    if (/期中.*(總複習|平時考|考前)/.test(t)) return { code: "國R1", sure: false };
    return { code: "", sure: true };
  }
  if (subject === "數學") {
    const m = /(?:^|[\s—－-])(\d+)-(\d+)/.exec(t);
    if (m) {
      const base = `數L${Number(m[1])}-${Number(m[2])}`;
      if (hasCode(base)) return { code: base, sure: true };
      if (hasCode(`${base}a`)) return { code: `${base}a`, sure: false };   // 6-2 拆成 2a／2b
      return { code: base, sure: true };
    }
    const u = /第([一二三四五六七八九十]+)單元/.exec(t);
    if (u) {                                   // 練習園地／重點複習訂正 → 該單元最後一小節
      const n = cnNum(u[1]);
      const last = hasCode.codes.filter(k => k.startsWith(`數L${n}-`)).sort().pop();
      return { code: last || "", sure: false };
    }
    if (/L1-L5|單元1-5|模擬測驗|綜合練習|習作範圍總驗收/.test(t)) return { code: "數R1", sure: false };
    return { code: "", sure: true };
  }
  if (subject === "社會") {
    const m = /^\s*(\d+)-(\d+)/.exec(t);
    if (m) return { code: `社${Number(m[1])}-${Number(m[2])}`, sure: true };
    if (/單元[一二三四]{1,2}.*(總複習|重點複習|圖表)|期中社會總複習|模擬測驗|考前觀念澄清/.test(t)) {
      return { code: "社R1", sure: false };
    }
    return { code: "", sure: true };
  }
  return { code: "", sure: true };
}

const plan = JSON.parse(await readFile(path.join(ROOT, "data", "daily-plan.json"), "utf8"));

// ── 教學單元：代碼 → pageId ──
const unitPages = await queryAll(DS.lessons);
const byCode = new Map();
for (const p of unitPages) {
  const title = (p.properties?.["單元"]?.title ?? []).map(t => t.plain_text).join("");
  const code = (CODE_RE.exec(title) || [])[1];
  if (code && !byCode.has(code)) byCode.set(code, p.id);
}
const hasCode = c => byCode.has(c);
hasCode.codes = [...byCode.keys()];
console.log(`📚 教學單元 ${unitPages.length} 列，解析出課次代碼 ${byCode.size} 個`);

// ── 逐日展開進度 ──
const byDate = {};
for (const subs of Object.values(plan.weeks || {})) {
  for (const s of SUBJECTS) {
    const arr = subs[s] || [];
    arr.forEach((e, i) => {
      (byDate[e.date] ||= {})[s] = { text: e.text, ...guessCode(s, e.text, i, arr, hasCode) };
    });
  }
}

// ── 既有列（冪等）──
const existing = await queryAll(DS.dailyPlan);
const existingDates = new Set(existing.map(p => p.properties?.["上課日"]?.date?.start).filter(Boolean));
if (existingDates.size) console.log(`ℹ️ Notion 已有 ${existingDates.size} 個上課日，將跳過`);

const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const rows = [];
const review = [];
let stat = { sure: 0, guess: 0, noMaterial: 0, none: 0 };

for (const d of plan.days || []) {
  const cells = byDate[d.date] || {};
  const props = {
    "日期": { title: rt(`${d.date}（${DOW_CN[d.dow] || "?"}）`) },
    "上課日": { date: { start: d.date } },
    "週次": { number: d.week },
    "學年": { select: { name: academicYearValue(d.date) } },   // 依該筆日期，不是今天
  };
  if (d.holiday) props["放假"] = { checkbox: true };
  if (d.note) props["重要行事"] = { rich_text: rt(d.note) };
  for (const s of SUBJECTS) {
    const c = cells[s];
    if (!c) continue;
    props[`${s}進度`] = { rich_text: rt(c.text) };
    const tag = !c.code ? (stat.none++, "⬜ 未指定")
      : !hasCode(c.code) ? (stat.noMaterial++, `${c.code} ⚠️ 教材未建（留空，之後自動掛）`)
      : c.sure ? (stat.sure++, "")
      : (stat.guess++, `${c.code} ❓ 推測`);
    if (c.code && hasCode(c.code)) props[`${s}單元`] = { relation: [{ id: byCode.get(c.code) }] };
    if (tag) review.push(`${d.date}\t${s}\t${c.text}\t${tag}`);
  }
  if (!existingDates.has(d.date)) rows.push({ date: d.date, props });
}

console.log(`\n📅 待建列 ${rows.length} / 全學期 ${plan.days.length} 天`);
console.log(`   單元對應：✅ 確定 ${stat.sure}　❓ 推測 ${stat.guess}　⚠️ 教材未建 ${stat.noMaterial}　⬜ 未指定 ${stat.none}`);
console.log(`\n── 需老師覆核／未掛上的格子（${review.length}）──`);
console.log(review.join("\n"));

if (!isExecute()) {
  console.log("\n🔍 dry-run：未寫入任何資料。確認上表無誤後改 mode=execute 重跑。");
  process.exit(0);
}

const { ok, fail } = await forEachThrottled(rows, r =>
  api("POST", "/pages", { parent: { data_source_id: DS.dailyPlan }, properties: r.props }));
console.log(`\n✅ 建立成功 ${ok.length} 列，失敗 ${fail.length} 列`);
for (const f of fail) console.error(`  ❌ ${f.item?.date}：${f.error || JSON.stringify(f.r?.json?.message)}`);
if (fail.length) process.exit(1);
