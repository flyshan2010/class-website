/**
 * f46｜只讀稽核：學習報告「+1 盡本分亮點句」該給誰、正式報告實際給了誰（2026-10-11）
 * ───────────────────────────────────────────────────────────────
 * 背景：第 6 週影子試跑照 class-report SKILL 字面給了 9 位，正式報告只給 2 位——先用程式照規則算一次，看差在哪。
 * 規則（class-report SKILL「+1 盡本分亮點句」）：
 *   資格＝本週沒有課堂負向、沒有亮點類紀錄、沒有課堂正向（量尺 +2 以上＝課堂表現正向）。
 *   開頭依序取第一個成立：①上週有課堂負向、本週沒有 ②本週「作業完成」天數＝本週上課天數
 *   ③本週有其他類正向紀錄 ④以上皆非。
 * 永遠只讀（只 import queryAll）。WEEK_LABEL＝週次標籤（逐字）。
 * ⚠️ PUBLIC repo：只印座號與判定代碼，不印姓名、事件描述與報告內文。
 */
import { readFile } from "node:fs/promises";
import { queryAll, DS } from "./lib/notion.mjs";
import { weekInfo } from "./lib/school-days.mjs";

const WEEK = String(process.env.WEEK_LABEL || "").trim();
if (!WEEK) { console.error("❌ 缺少 week（週次標籤）"); process.exit(1); }
const readJSON = async f => JSON.parse(await readFile(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const txt = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text) ?? []).map(t => t.plain_text).join("");
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const num = (p, k) => p.properties?.[k]?.number ?? null;
const rel = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
const day = p => (p.properties?.["日期"]?.date?.start ?? "").slice(0, 10);

// 週次：本週與上一週的標籤、本週上課天數
const weeks = (await readJSON("weeks.json")).學期.flatMap(t => t.週 ?? []);
const wi = weeks.findIndex(w => w.標籤 === WEEK);
if (wi < 0) { console.error(`❌ weeks.json 沒有「${WEEK}」`); process.exit(1); }
const PREV = wi > 0 ? weeks[wi - 1].標籤 : "";
const wk = weekInfo(await readJSON("daily-plan.json"), weeks[wi].起, { from: weeks[wi].起, to: weeks[wi].迄 });
const SCHOOL_DAYS = wk.schoolDays.length;

const roster = (await queryAll(DS.roster)).filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: num(p, "座號") })).filter(r => Number.isFinite(r.seat)).sort((a, b) => a.seat - b.seat);
const logs = await queryAll(DS.log);
const of = (label, sid) => logs.filter(p => txt(p, "週次") === label && rel(p, "學生").includes(sid));
const clsNeg = p => sel(p, "類別") === "課堂表現" && sel(p, "正負向") === "－";
const clsPos = p => sel(p, "類別") === "課堂表現" && sel(p, "正負向") === "＋";
const isHw = p => txt(p, "事件描述") === "作業完成" || /作業完成獎勵$/.test(txt(p, "事件描述"));

const reports = (await queryAll(DS.reports)).filter(p => txt(p, "期間") === WEEK && sel(p, "報告類型") === "每週");
const repOf = new Map(reports.map(p => [num(p, "座號"), txt(p, "學生亮點")]));
const openOf = t => !t.includes("遵守上課規則、專心聽講") ? "－"
  : t.includes("比上週更穩了") ? "①" : t.includes("作業天天交齊") ? "②" : t.includes("上課也都能") ? "③" : "④";

console.log(`🎯 ${WEEK}｜上一週 ${PREV || "（無）"}｜本週上課 ${SCHOOL_DAYS} 天｜在學 ${roster.length} 人｜每週報告 ${reports.length} 份`);
console.log("座號｜程式判資格（不給原因：負＝課堂負向 亮＝亮點類 正＝課堂正向）｜程式判開頭｜正式報告開頭（－＝沒有這句）｜是否一致");
let should = 0, got = 0, miss = [], extra = [], diffOpen = [];
for (const r of roster) {
  const cur = of(WEEK, r.id);
  const why = [cur.some(clsNeg) ? "負" : "", cur.some(p => sel(p, "類別") === "亮點") ? "亮" : "", cur.some(clsPos) ? "正" : ""].join("");
  const ok = !why;
  const hwDays = new Set(cur.filter(p => txt(p, "事件描述") === "作業完成").map(day)).size;
  const want = !ok ? "－"
    : PREV && of(PREV, r.id).some(clsNeg) ? "①"
    : SCHOOL_DAYS > 0 && hwDays >= SCHOOL_DAYS ? "②"
    : cur.some(p => sel(p, "正負向") === "＋" && sel(p, "類別") !== "課堂表現" && !isHw(p)) ? "③" : "④";
  const has = repOf.has(r.seat) ? openOf(repOf.get(r.seat)) : "無報告";
  if (ok) should++;
  if (has !== "－" && has !== "無報告") got++;
  const same = want === has;
  if (ok && has === "－") miss.push(r.seat);
  if (!ok && has !== "－" && has !== "無報告") extra.push(r.seat);
  if (ok && has !== "－" && !same) diffOpen.push(r.seat);
  console.log(`座號${r.seat}｜${ok ? "該給" : `不給（${why}）`}｜${want}｜${has}｜${same ? "一致" : "❗不一致"}｜作業完成 ${hwDays} 天`);
}
console.log(`\n📊 程式判該給 ${should} 位｜正式報告有這句 ${got} 位`);
console.log(`   該給卻沒有：${miss.join("、") || "（無）"}`);
console.log(`   不該給卻有：${extra.join("、") || "（無）"}`);
console.log(`   有給但開頭不同：${diffOpen.join("、") || "（無）"}`);
console.log("🔍 只讀稽核：未寫入任何資料");
