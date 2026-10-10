/**
 * f43｜學習報告「各科個人一句」的機器判定（只讀，2026-10-03 老師裁定規則）
 * ───────────────────────────────────────────────────────────────
 * 輸出每位學生、每科：①級距＝該科當週＋向紀錄「次數」加總（1／2／3+，0＝鼓勵＋問重點）
 *   ②作業提醒種類（缺交／未訂正，依作業科目歸科；無科目→歸「家長協助建議」）③請假未補完。
 * 句子本身（各週重點題目）由 class-report 依週報課程重點寫；本程式只決定「每格用哪一種」，結果由輸入決定（U72）。
 * 請假規則：紀錄庫備註含「請假」的打掃／午餐缺席列＝請假日；
 *   打掃在上午（老師 2026-10-03）：只有午餐缺席＝下午請假→算當天派的作業；只有打掃缺席＝上午請假→算當天要收的；
 *   兩者都有＝全天→兩種都算。聯絡簿一律不算。
 *   受影響作業之後的作業清點（含「作業補交完成」）有出現＝補完（當作沒有負向）；沒出現＝請假未補完（請假句，不用「負責」句）。
 *   「未訂正」永遠不算請假造成。
 * 家長句（老師 2026-10-03）：缺交／未訂正到報告當下仍沒補完（補交追蹤點「完成」才會留「作業補交完成」）→ 家長「作業未補完」；
 *   補完了就只留科目提醒句。作業名讀不出（一句話記錄沒有作業清單）＝判不出是否補完 → 當作未補完（fail-closed）。
 * 其他科（自然／英語）請假未補完：老師用一句話任務記「請假期間<科>作業未補完」（類別作業、中性、0 幣）→ 家長「請假未補完:<科>」；
 *   程式不自己從清點推其他科（2026-10-03）。寫的是國數社就併進該科請假句。
 * 永遠只讀。WEEK_LABEL＝週次標籤（逐字）。⚠️ PUBLIC repo：只印學生頁面 id 片段與判定代碼，不印姓名、座號、內容。
 */
import { queryAll, DS, propText } from "./lib/notion.mjs";
import { hwSubjectOfItem } from "./lib/cm-events.mjs";
import { toNotices } from "./lib/f43-notices.mjs";

const WEEK = (process.env.WEEK_LABEL ?? "").trim();
if (!WEEK) { console.log("❌ 需填 week（週次標籤）"); process.exit(1); }
const n = Number(WEEK.match(/第(\d+)週/)?.[1]);
const SUBJ = ["國語", "數學", "社會"];
const sid = (id) => String(id).replace(/-/g, "").slice(12, 20);
const rel = (p) => (p.properties?.學生?.relation ?? []).map((r) => r.id);
const day = (p) => p.properties?.日期?.date?.start ?? "";
const mmdd = (iso) => iso.slice(5, 7) + "-" + iso.slice(8, 10);
const items = (note) => String(note || "").split("、").map((s) => s.trim()).map((s) => {
  const m = s.match(/^(.*?)（(\d\d-\d\d) 派）$/); return m ? { key: `${m[1]}|${m[2]}`, name: m[1], sent: m[2] } : null;
}).filter(Boolean).filter((i) => !["", "其他"].includes(hwSubjectOfItem(i.name)));   // 聯絡簿不算；自然／英語等其他科老師用一句話任務處理（2026-10-03），報告不管

const all = await queryAll(DS.log, { filter: { property: "週次", rich_text: { contains: `第${n}週` } } });
const next = await queryAll(DS.log, { filter: { property: "週次", rich_text: { contains: `第${n + 1}週` } } });
const wk = all.filter((p) => propText(p, "週次") === WEEK);
const done = [...wk, ...next].filter((p) => propText(p, "類別") === "作業" && propText(p, "事件描述") === "作業完成");
const roster = await queryAll(DS.roster);
const out = {};
for (const st of roster) {
  const s = st.id, o = { 家長: [] };
  for (const k of SUBJ) o[k] = { n: 0, rem: [], leave: false };
  // ① 級距
  for (const p of wk) if (rel(p).includes(s) && SUBJ.includes(propText(p, "科目")) && propText(p, "正負向") === "＋" && propText(p, "類別") !== "作業")
    o[propText(p, "科目")].n += p.properties?.次數?.number || 1;
  // 請假日與受影響作業
  const lv = new Map();
  for (const p of wk) if (rel(p).includes(s) && propText(p, "備註").includes("請假")) {
    const d = day(p), t = propText(p, "事件描述"); const e = lv.get(d) ?? { lunch: false, other: false };
    if (t.includes("午餐")) e.lunch = true; else e.other = true; lv.set(d, e);
  }
  const affected = new Map();
  for (const [d, e] of lv) for (const p of done) for (const it of items(propText(p, "備註"))) {
    if (e.lunch && it.sent === mmdd(d)) affected.set(it.key, it);   // 下午不在（午餐缺席）：當天派的
    if (e.other && day(p) === d) affected.set(it.key, it);          // 上午不在（打掃缺席，打掃在上午）：當天要收的
  }
  // 有交的證據：作業完成清點，或被記「未訂正」（有交才會被要求訂正）
  const handed = [...wk, ...next].filter((p) => rel(p).includes(s) && propText(p, "類別") === "作業" && (["作業完成", "作業補交完成"].includes(propText(p, "事件描述")) || propText(p, "事件描述").includes("訂正")));
  const mineKeys = new Set(handed.flatMap((p) => items(propText(p, "備註")).map((i) => i.key)));
  const madeUp = new Set([...wk, ...next].filter((p) => rel(p).includes(s) && propText(p, "事件描述") === "作業補交完成")
    .flatMap((p) => items(propText(p, "備註")).map((i) => i.key)));
  // ② 作業負向
  for (const p of wk) if (rel(p).includes(s) && propText(p, "類別") === "作業" && propText(p, "正負向") === "－") {
    const t = propText(p, "事件描述"); const kind = t.includes("沒交") || t.includes("缺交") ? "缺交" : t.includes("訂正") ? "未訂正" : null;
    if (!kind) continue;
    const hs = (p.properties?.作業科目?.multi_select ?? []).map((x) => x.name);
    if (hs.length && hs.every((x) => x === "其他")) continue;   // 只有其他科：老師用一句話任務處理
    const its = items(propText(p, "備註"));
    if (kind === "缺交" && its.length && its.every((i) => affected.has(i.key))) continue;   // 請假造成：交給 ③ 判補完
    if ((!its.length || its.some((i) => !madeUp.has(i.key))) && !o.家長.includes("作業未補完")) o.家長.push("作業未補完");
    const subs = (p.properties?.作業科目?.multi_select ?? []).map((x) => x.name).filter((x) => SUBJ.includes(x));
    if (!subs.length) continue;   // 作業科目空白／其他科：不歸科，只看上一行的家長句
    for (const k of subs) if (!o[k].rem.includes(kind)) o[k].rem.push(kind);
  }
  // ③ 請假未補完（老師一句話記的，其他科只靠這條）
  for (const p of wk) if (rel(p).includes(s) && propText(p, "類別") === "作業") {
    const m = propText(p, "事件描述").match(/請假期間(.+?)作業未補完/); if (!m) continue;
    for (const k of m[1].split(/[、，,和及]/).map((x) => x.trim().replace(/^英文$/, "英語")).filter(Boolean)) {
      if (SUBJ.includes(k)) o[k].leave = true; else if (!o.家長.includes(`請假未補完:${k}`)) o.家長.push(`請假未補完:${k}`);
    }
  }
  for (const it of affected.values()) if (!mineKeys.has(it.key)) { const k = hwSubjectOfItem(it.name); if (SUBJ.includes(k)) o[k].leave = true; }   // 其他科已在 items() 排除；判不出科（作業科目標需人工）不猜
  out[sid(s)] = o;
}
const brief = Object.entries(out).map(([k, o]) => `${k} ` + SUBJ.map((s) => `${s[0]}${o[s].n}${o[s].rem.map((r) => r[0]).join("")}${o[s].leave ? "假" : ""}`).join(" ") + (o.家長.length ? ` 家長:${o.家長.join("/")}` : "")).join("\n");
console.log(`f43｜${WEEK}｜代碼：科目首字＋次數，後綴 缺＝缺交、未＝未訂正、假＝請假未補完\n${brief}`);
console.log("F43JSON " + JSON.stringify(out));
// 雲端排程讀不到 Actions 日誌（下載網域被擋），同一份 JSON 另切段寫成 notice 註記，可經 api.github.com 讀回（2026-10-10）。
// 內容與上一行相同（只有頁面 id 片段與判定代碼）；讀取端＝classos-private 的 personal-tiers.mjs parseAnnotations。
if (process.env.GITHUB_ACTIONS) for (const l of toNotices(JSON.stringify(out))) console.log(l);
