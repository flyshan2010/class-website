/**
 * 只讀演練｜課堂作答弱點分析（CG 線 P2d）：虛構事件包 → f35 planPacket → 紀錄庫列（toNotionProps→回讀形狀）
 *   → lib/assess-weak.mjs（sync 用的同一支）→ 教師儀表板 assess／學生報告 period.assess，逐項比對手算答案。
 * 不連 Notion、不寫任何資料。可選 --out <資料夾>：把明文與用 sync 同一套演算法加密的檔案寫到該資料夾，給本機預覽畫面用。
 * ⚠️ PUBLIC repo：只用虛構座號與虛構頁面 id，不含學生資料。
 * 執行：node scripts/classos/sim/assess-weak.mjs [--out <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { planPacket, toNotionProps } from "../lib/cm-events.mjs";
import { rowFromRecord, teacherWeeks, seatWeek, weekKey, LOW_RATE } from "../lib/assess-weak.mjs";

const data = (f) => JSON.parse(readFileSync(new URL(`../../../data/${f}`, import.meta.url), "utf8"));
const rules = data("class-rules.json"), weeks = data("weeks.json");
const roster = new Map(Array.from({ length: 27 }, (_, i) => [i + 1, `fake-${i + 1}`]));
const seatOfId = new Map([...roster].map(([s, id]) => [id, s]));

// 三節虛構課：同一週（10/27–10/29）；推論刻意偏難。座號 8 第一節請假、20 全部未答、15 只上後半節。
const LESSONS = [
  { lesson: "國R1-3", date: "2026-10-28", items: [["Q1", "修辭"], ["Q2", "修辭"], ["Q3", "句型"], ["Q4", "句型"], ["Q5", "書信"], ["C1", "修辭"], ["C2", "句型"], ["C3", "提取"]] },
  { lesson: "國L8-1", date: "2026-10-29", items: [["Q1", "句型"], ["Q2", "推論"], ["Q3", "推論"], ["Q4", "大意"], ["Q5", "修辭"], ["C1", "推論"], ["C2", "大意"]] },
  { lesson: "國L8-2", date: "2026-10-30", items: [["Q1", "推論"], ["Q2", "大意"], ["Q3", "修辭"], ["Q4", "提取"], ["Q5", "句型"], ["C1", "推論"], ["C2", "提取"], ["C3", "大意"]] },
];
const HARD = { 推論: 5, 大意: 2, 修辭: 1, 句型: 2, 提取: 1, 書信: 1 };
const res = (s, li, k, kp) => s === 20 ? "N" : ((s * 11 + k * 7 + li * 3) % 10) < HARD[kp] ? "X" : (s + k + li) % 17 === 0 ? "N" : "O";
const present = (s, li, cp) => !(s === 8 && li === 0) && !(s === 15 && li === 0 && cp[0] === "Q");

const rows = [], expectItems = [];
LESSONS.forEach((L, li) => {
  const events = [];
  for (let s = 1; s <= 27; s++) {
    const segs = L.items.filter(([cp]) => present(s, li, cp)).map(([cp, kp], k) => `${cp}:${kp}:${res(s, li, L.items.findIndex(x => x[0] === cp), kp)}`);
    if (!segs.length) continue;
    const right = segs.filter(x => x.endsWith(":O")).length, rec = segs.length;
    events.push({ id: `assess-${L.date.replaceAll("-", "")}-s${s}-a${L.lesson}`, seat: s, src: "assess", act: "課堂作答", subj: "國語", lesson: L.lesson, r: segs.join(","),
      kind: right * 10 >= rec * 8 ? "good" : right * 2 <= rec ? "bad" : "neutral" });
    segs.forEach(x => { const [, kp, c] = x.split(":"); expectItems.push({ s, li, kp, c }); });
  }
  const text = `#CM-EVENTS v1 · 演練\n${JSON.stringify({ tool: "assess", date: L.date, events })}`;
  const plan = planPacket(text, { rules, weeks, roster, existingIds: new Set() });
  for (const r of plan.results) {
    if (r.action !== "write") throw new Error(`f35 沒寫入：${JSON.stringify(r)}`);
    const p = toNotionProps(r.row);   // 回讀形狀：sync 的 props() 會把 title／rich_text 攤平成字串、relation 成 id 陣列
    const flat = { 類別: p.類別.select.name, 事件描述: p.事件描述.title[0].text.content, 學生: p.學生.relation.map(x => x.id),
      日期: p.日期.date, 週次: p.週次.rich_text[0]?.text.content ?? "", 作答明細: p.作答明細?.rich_text[0]?.text.content ?? "" };
    rows.push(flat);
  }
});
// 雜訊：非課堂作答列、壞格式列 → 必須被略過
rows.push({ 類別: "課堂表現", 事件描述: "座號3 舉手回答", 學生: ["fake-3"], 日期: { start: "2026-10-28" }, 週次: "四上第9週(10/26-10/30)", 作答明細: "" });
rows.push({ 類別: "課堂表現", 事件描述: "國R1-3 課堂作答：小考 1/1", 學生: ["fake-3"], 日期: { start: "2026-10-28" }, 週次: "四上第9週(10/26-10/30)", 作答明細: "Q1:修辭" });

let fails = 0;
const check = (name, ok, d = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${d ? "｜" + d : ""}`); if (!ok) fails++; };
const parsed = rows.map(r => rowFromRecord(r, seatOfId));
const good = parsed.filter(x => !x.skip);
check("紀錄庫列 → 作答列：雜訊 2 筆被略過", parsed.filter(x => x.skip).length === 2, parsed.filter(x => x.skip).map(x => x.skip).join("；"));

const tw = teacherWeeks(good, weeks);
check("全部落在同一週（週次取 f35 寫的標籤）", tw.length === 1 && tw[0].label === "四上第9週(10/26-10/30)", tw.map(w => w.label).join("、"));
const W = tw[0];
const hand = (filter) => { const xs = expectItems.filter(filter); const o = xs.filter(x => x.c === "O").length; return { o, rec: xs.length, rate: xs.length >= 3 ? Math.floor((200 * o + xs.length) / (2 * xs.length)) : null }; };
const kpBad = W.classKp.filter(k => { const h = hand(x => x.kp === k.kp); return h.o !== k.o || h.rec !== k.rec || h.rate !== k.rate; });
check("全班各知識點＝手算", kpBad.length === 0, W.classKp.map(k => `${k.kp} ${k.o}/${k.rec}=${k.rate}%`).join("、"));
const weak = W.classKp.filter(k => k.rate != null && k.rate < LOW_RATE).map(k => k.kp);
check("推論被標為全班弱點（<60%）", weak.includes("推論"), weak.join("、"));
check("節次三節、人數＝在場人數", W.lessons.map(l => `${l.lesson}:${l.n}`).join(",") === "國R1-3:26,國L8-1:27,國L8-2:27", W.lessons.map(l => `${l.lesson}:${l.n}`).join(","));
const seatBad = [];
for (const s of Object.keys(W.bySeat).map(Number)) for (const k of W.bySeat[s]) {
  const h = hand(x => x.s === s && x.kp === k.kp);
  if (h.o !== k.o || h.rec !== k.rec || h.rate !== k.rate) seatBad.push(`${s}/${k.kp}`);
}
check("座號×知識點＝手算（27 生）", seatBad.length === 0 && Object.keys(W.bySeat).length === 27, seatBad.slice(0, 5).join("、"));
check("請假座號 8 在國R1-3 不算分母", W.lessons[0].kp.reduce((a, k) => a + k.rec, 0) === expectItems.filter(x => x.li === 0).length);
const s20 = seatWeek(good, 20, weekKey(W.label).key);
check("全未答（20）：有判斷的知識點全部 0% 且列為弱點", s20.subjects[0].kp.filter(k => k.rate != null).every(k => k.rate === 0) && s20.weak.length > 0, s20.weak.join("、"));
const s15 = seatWeek(good, 15, weekKey(W.label).key);
check("家長版只含自己那週、只有知識點與人數無關欄位", s15 && !JSON.stringify(s15).match(/"seat"|fake-/), JSON.stringify(s15).slice(0, 120));
check("隔週沒有紀錄＝null（不顯示）", seatWeek(good, 1, "四上|10") === null);
check("教師檔不含頁面 id", !JSON.stringify(tw).includes("fake-"));

// --out：寫出本機預覽用檔案（明文＋用 sync 同一套參數加密）
const i = process.argv.indexOf("--out");
if (i > 0) {
  const dir = process.argv[i + 1]; mkdirSync(dir, { recursive: true });
  const b64 = (buf) => Buffer.from(buf).toString("base64");
  const enc = async (obj, code, seat) => {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${seat}:${code}`), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)))) };
  };
  // 教師儀表板（口令 sim-pw）與 15 號學生報告（查詢碼 SIM15）：欄位只放畫面需要的最小殼，其餘照 sync 形狀
  const wk = W.label, seats = [...roster.keys()];
  const dash = { v: 1, generatedAt: new Date().toISOString(), seats, dims: ["國語", "數學", "社會", "人際互動", "生活技能"],
    weeks: [{ label: wk, from: W.from, to: W.to }], scores: Object.fromEntries(seats.map(s => [s, { 國語: [4], 數學: [4], 社會: [4], 人際互動: [4], 生活技能: [4] }])),
    status: Object.fromEntries(seats.map(s => [s, ["已發布"]])), records: [rows.length], essay: null, assess: tw };
  mkdirSync(`${dir}/reports`, { recursive: true });
  writeFileSync(`${dir}/teacher-dashboard.json`, JSON.stringify(await enc(dash, "sim-pw", "teacher")));
  const period = { period: wk, reportType: "每週", radar: { 國語: 4, 數學: 4, 社會: 4, 人際互動: 4, 生活技能: 4 }, grades: { 上課參與: "優" },
    subjects: [{ name: "國語", state: "（演練）", advice: "（演練）" }], assess: s15 };
  writeFileSync(`${dir}/reports/15.json`, JSON.stringify(await enc({ name: "演練學生", seat: 15, avatar: "", balance: null, finance: null, periods: [period], proposals: [], quiz: null }, "SIM15", 15)));
  writeFileSync(`${dir}/reports/index.json`, JSON.stringify([15]));
  console.log(`📁 已寫出 ${dir}/teacher-dashboard.json（口令 sim-pw）、reports/15.json（查詢碼 SIM15）`);
}
console.log(fails ? `\n❌ ${fails} 項不通過` : "\n✅ 全部通過");
process.exit(fails ? 1 : 0);
