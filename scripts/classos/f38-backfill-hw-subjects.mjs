/**
 * f38｜回填紀錄庫「作業科目」（一次性，2026-10-02 老師裁定方案 A）
 * ───────────────────────────────────────────────────────────────
 * 背景：學習報告「各科建議」改成「本週課程重點＋各科個人一句」，個人一句只給該科本週有紀錄的學生；
 *   但作業清點送來的作業紀錄（作業完成 tally、班規④ 未交／沒訂正）科目欄都是空的。
 *   方案 A：不拆列、不改 id／事件描述／金幣，只另寫多選欄「作業科目」（R18 入庫端 2026-10-02 起自動寫，
 *   見 lib/cm-events.mjs hwSubjectsFor）。這支用**同一支函式**把第 1–5 週的舊列補上。
 *
 * 只寫「作業科目」一欄，不碰金幣影響、次數、事件描述、科目——週結與評分完全不受影響。
 * 略過：已有作業科目的列（重跑不覆寫）、週結寫回列（第N週作業完成獎勵：入帳彙總，不是當天作業）。
 * 判不出（備註空、作業名沒有可辨識的縮寫、老師一句話的作業列沒填科目）→ 寫「需人工」，不猜（U53）。
 *
 * MODE=dry-run（預設，只查不寫）／execute。WEEK_LABEL 可只跑一週（逐字等於週次標籤），留空＝全部。
 * ⚠️ PUBLIC repo：只印週次、座號、筆數與作業名（作業名是聯絡簿公開內容），不印事件描述、姓名、頁面 id。
 */
import { queryAll, api, getSchema, forEachThrottled, isExecute, DS } from "./lib/notion.mjs";
import { hwSubjectsFor, hwSubjectOfItem, fromNotionPage, HW_MANUAL } from "./lib/cm-events.mjs";

const EXECUTE = isExecute();
const ONLY_WEEK = (process.env.WEEK_LABEL ?? "").trim();
const OPTIONS = ["國語", "數學", "社會", "其他", HW_MANUAL];
const SETTLE = /^第\s*\d+\s*週/;

console.log(`f38｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}${ONLY_WEEK ? `｜只跑 ${ONLY_WEEK}` : "｜全部週次"}`);

// 欄位存在且選項齊全才寫（缺欄位時 PATCH 會整批被拒，先擋下）
const prop = (await getSchema(DS.log))["作業科目"];
const have = new Set((prop?.multi_select?.options ?? []).map((o) => o.name));
const missing = OPTIONS.filter((o) => !have.has(o));
if (prop?.type !== "multi_select" || missing.length) {
  console.log(`${EXECUTE ? "❌" : "⚠️"} 紀錄庫「作業科目」${prop ? `型別 ${prop.type}，缺選項：${missing.join("、") || "無"}` : "欄位不存在"}——先在 Notion 建好多選欄（${OPTIONS.join("／")}）`);
  if (EXECUTE) process.exit(1);
}

const roster = await queryAll(DS.roster);
const seatOf = new Map(roster.map((p) => [p.id.replace(/-/g, ""), p.properties?.座號?.number]));   // fromNotionPage 的學生 id 不含連字號

const pages = await queryAll(DS.log, { filter: { property: "類別", select: { equals: "作業" } } });
const rows = pages.map((p) => ({ id: p.id, page: p, r: fromNotionPage(p) }))
  .filter(({ r }) => !ONLY_WEEK || r.週次 === ONLY_WEEK);
console.log(`紀錄庫 類別＝作業 ${pages.length} 列${ONLY_WEEK ? `，本次範圍 ${rows.length} 列` : ""}`);

const byWeek = new Map();
const W = (w) => byWeek.get(w) ?? byWeek.set(w, { all: 0, settle: 0, done: 0, todo: 0, combo: new Map(), manual: 0 }).get(w);
const unknownItems = new Map();   // 判不出的作業名 → 次數
const manualOther = [];           // 非作業清點的需人工列（只記週次＋日期＋座號）
const todo = [];

for (const { id, r } of rows) {
  const w = W(r.週次 || "（無週次）");
  w.all++;
  if (SETTLE.test(r.事件描述)) { w.settle++; continue; }
  if (r.作業科目.length) { w.done++; continue; }
  const tool = r.事件id.split("-")[0];   // 事件id＝<工具>-<日期>-s<座號>-<特徵>；一句話紀錄沒有事件id
  const subjects = hwSubjectsFor({ category: "作業", tool, note: r.備註, subject: r.科目 });
  w.todo++;
  const k = subjects.join("、");
  w.combo.set(k, (w.combo.get(k) ?? 0) + 1);
  if (subjects.includes(HW_MANUAL)) {
    w.manual++;
    if (tool === "homework") {
      for (const it of String(r.備註 ?? "").split("、").map((x) => x.trim()).filter(Boolean)) {
        if (!hwSubjectOfItem(it)) unknownItems.set(it, (unknownItems.get(it) ?? 0) + 1);
      }
      if (!String(r.備註 ?? "").trim()) unknownItems.set("（空備註）", (unknownItems.get("（空備註）") ?? 0) + 1);
    } else {
      const seats = r.學生.split(",").filter(Boolean).map((s) => seatOf.get(s) ?? "?");
      manualOther.push(`${r.週次 || "（無週次）"} ${r.日期} 座號${seats.join("、")}`);
    }
  }
  todo.push({ id, subjects });
}

for (const [w, s] of [...byWeek.entries()].sort()) {
  const combos = [...s.combo.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("　");
  console.log(`\n▸ ${w}：作業列 ${s.all}｜週結寫回略過 ${s.settle}｜已有作業科目 ${s.done}｜要回填 ${s.todo}（需人工 ${s.manual}）`);
  if (combos) console.log(`   ${combos}`);
}
if (unknownItems.size) {
  console.log(`\n判不出科目的作業名（作業清點）：`);
  for (const [it, n] of [...unknownItems.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${it}　×${n}`);
}
if (manualOther.length) console.log(`\n非作業清點、也沒填科目的作業列（需人工）：\n   ${manualOther.join("\n   ")}`);

const total = todo.length, manual = todo.filter((t) => t.subjects.includes(HW_MANUAL)).length;
console.log(`\n合計要回填 ${total} 列（其中需人工 ${manual} 列）`);
if (!EXECUTE) { console.log("🔍 DRY-RUN：未寫入。確認上面數字後改 MODE=execute。"); process.exit(0); }

let mismatch = 0;
const res = await forEachThrottled(todo, async (t) => {
  const w = await api("PATCH", `/pages/${t.id}`, { properties: { 作業科目: { multi_select: t.subjects.map((name) => ({ name })) } } });
  if (!w.ok) return { ok: false, why: `HTTP ${w.status}` };
  const back = fromNotionPage((await api("GET", `/pages/${t.id}`)).json ?? {});   // 回讀：寫入成功≠內容正確
  if ([...back.作業科目].sort().join() !== [...t.subjects].sort().join()) { mismatch++; return { ok: false, why: "回讀不符" }; }
  return { ok: true };
});
console.log(`✅ 寫入並回讀相符 ${res.ok.length} 列｜失敗 ${res.fail.length} 列（回讀不符 ${mismatch}）`);
for (const f of res.fail.slice(0, 20)) console.log(`   ❌ ${f.r?.why ?? f.error}`);
process.exitCode = res.fail.length ? 1 : 0;
