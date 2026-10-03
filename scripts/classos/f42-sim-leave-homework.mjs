/**
 * f42｜只讀模擬：請假與作業缺交的個人句提醒判斷（2026-10-03，老師要求用第 4、5 週真實資料驗證可行性）
 * ───────────────────────────────────────────────────────────────
 * 規則（老師 2026-10-03 裁定，學習報告各科個人句後面的提醒）：
 *   - 該科有作業負向：缺交→「本週有作業缺交情況，作業要準時交，這才是負責的表現喔！」
 *     未訂正→「本週有作業未訂正情況，有錯要記得訂正，這才是負責的表現喔！」兩種都有→合併句
 *   - 因請假造成（作業派發日或收作業日當天該生請假）：
 *       之後的作業清點有補完→當作沒有負向（不加提醒）；沒補完→「本週請假期間的作業，記得找時間補完喔！」
 * 請假判定：紀錄庫「備註」含「請假」的列（R 系列打掃／午餐缺席）。
 * 補完判定：該生在請假日之後的「作業完成」清點列，備註裡出現同一份作業（作業名＋派發日）。
 * 永遠只讀。⚠️ PUBLIC repo：學生只印頁面 id 片段（非座號、非姓名），不印紀錄內容以外的個資。
 */
import { queryAll, DS, propText } from "./lib/notion.mjs";

const WEEKS = ["四上第4週(9/21-9/25)", "四上第5週(9/28-10/2)"];
const LATER = ["四上第6週(10/5-10/9)"]; // 補交可能落在下週
const sid = (id) => String(id).replace(/-/g, "").slice(12, 20);
const rel = (p) => (p.properties?.學生?.relation ?? []).map((r) => r.id);
const day = (p) => p.properties?.日期?.date?.start ?? "";
const mmdd = (iso) => iso.slice(5, 7) + "-" + iso.slice(8, 10);
// 「國習 L3 P.20-21（09-16 派）」→ { key: "國習 L3 P.20-21|09-16", sent: "09-16" }
const items = (note) => String(note || "").split("、").map((s) => s.trim()).filter(Boolean).map((s) => {
  const m = s.match(/^(.*?)（(\d\d-\d\d) 派）$/);
  return m ? { key: `${m[1]}|${m[2]}`, name: m[1], sent: m[2] } : null;
}).filter(Boolean);

const rows = [];
for (const w of [...WEEKS, ...LATER]) rows.push(...await queryAll(DS.log, { filter: { property: "週次", rich_text: { equals: w } } }));
const leave = rows.filter((p) => propText(p, "備註").includes("請假") && WEEKS.includes(propText(p, "週次")));
const hw = rows.filter((p) => propText(p, "類別") === "作業");
const done = hw.filter((p) => propText(p, "事件描述") === "作業完成");
const neg = hw.filter((p) => propText(p, "正負向") === "－");

// 請假（學生×日期）去重
const L = new Map();
for (const p of leave) for (const s of rel(p)) L.set(`${s}|${day(p)}`, { s, d: day(p) });
console.log(`f42｜第4–5週請假（學生×日）共 ${L.size} 筆；作業清點 ${done.length} 列、作業負向 ${neg.length} 列\n`);

for (const { s, d } of [...L.values()].sort((a, b) => a.d.localeCompare(b.d))) {
  // 請假當天派的作業（看全班當天以後的清點備註）＋請假當天要收的作業（全班當天清點列的備註）
  const sentThatDay = new Map(), dueThatDay = new Map();
  for (const p of done) for (const it of items(propText(p, "備註"))) {
    if (it.sent === mmdd(d)) sentThatDay.set(it.key, it);
    if (day(p) === d) dueThatDay.set(it.key, it);
  }
  const affected = new Map([...sentThatDay, ...dueThatDay]);
  const mine = done.filter((p) => rel(p).includes(s));
  const myKeys = (after) => new Set(mine.filter((p) => day(p) > after).flatMap((p) => items(propText(p, "備註")).map((i) => i.key)));
  const later = myKeys(d), any = new Set(mine.flatMap((p) => items(propText(p, "備註")).map((i) => i.key)));
  const myNeg = neg.filter((p) => rel(p).includes(s) && (day(p) === d || items(propText(p, "備註")).some((i) => i.sent === mmdd(d))));
  console.log(`■ 學生 ${sid(s)}　請假 ${d}　自己清點列 ${mine.length}　當天相關作業 ${affected.size} 份　該生這天相關負向 ${myNeg.length} 筆`);
  let miss = 0;
  for (const it of affected.values()) {
    const ok = later.has(it.key) || any.has(it.key);
    if (!ok) miss++;
    console.log(`   ${ok ? "✅ 有交/補完" : "⬜ 清點查無"}　${it.name}（${it.sent} 派）${sentThatDay.has(it.key) ? "〔請假日派〕" : ""}${dueThatDay.has(it.key) ? "〔請假日收〕" : ""}`);
  }
  for (const p of myNeg) console.log(`   ⚠️ 負向紀錄 ${day(p)}「${propText(p, "事件描述")}」作業科目=${propText(p, "作業科目") || "空"}`);
  const branch = !myNeg.length && !miss ? "一般情況（無提醒）"
    : miss ? "請假未補完 →「本週請假期間的作業，記得找時間補完喔！」"
    : "請假但已補完 → 當作沒有負向（無提醒）";
  console.log(`   → 判定：${branch}\n`);
}
