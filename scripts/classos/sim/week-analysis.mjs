/**
 * 計分口徑施工的資料分析（只讀，2026-09-11）：用本週與上週真實資料檢查
 *   A 打掃未達標 ≥3 的 ③ −5 有沒有人算、有沒有入帳
 *   B 週結寫回紀錄庫的預演（列數、日期、學年、防重複鍵、重跑是否全略過）
 *   C 學習報告推導 ④ 與週結判定是否一致
 *   D 輔導門檻：舊口徑（所有負向）vs 新口徑（只數班規紀錄）
 *   E ⑤ 班級常規獎勵：被「班規紀錄」扣掉的天數與金額
 *   F 免打掃券：真實使用紀錄與同日打掃缺席的重疊
 * ⚠️ PUBLIC repo：只印座號、日期、次數、金額與固定字串，不印事件描述原文。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, DS } from "../lib/notion.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const num = (p, k) => {
  const v = p.properties?.[k];
  return v?.number ?? v?.formula?.number ?? v?.rollup?.number ?? null;
};
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
const dateOf = (p, k) => (p.properties?.[k]?.date?.start ?? "").slice(0, 10);
const TALLY = new Set(["打掃未達標", "打掃缺席", "打掃支援", "作業完成", "午餐缺席", "午餐支援", "常規未達成"]);
const WB = /^第\d+週/;
const CIRCLE = "①②③④⑤⑥⑦⑧⑨⑩";
const yearOf = d => String(Number(d.slice(0, 4)) - 1911 - (Number(d.slice(5, 7)) < 8 ? 1 : 0));
const fmt = m => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => `${s}:${v}`).join(" ") || "（無）";

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const weeks = JSON.parse(await readFile(path.join(ROOT, "data", "weeks.json"), "utf8"));
let term = null, cur = null;
for (const t of weeks.學期 ?? []) {
  const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
  if (w) { term = t; cur = w; break; }
}
if (!cur) { console.log("今天不在上課週，不分析"); process.exit(0); }
const prev = (term.週 ?? []).find(w => w.週次 === cur.週次 - 1) ?? null;
const labelEnd = w => {
  const m = String(w.標籤).match(/-(\d+)\/(\d+)\)/);
  if (!m) return null;
  const y = Number(w.起.slice(0, 4)) + (Number(m[1]) < Number(w.起.slice(5, 7)) ? 1 : 0);
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
console.log(`📅 ${today}｜本週 ${cur.標籤}${prev ? `｜上週 ${prev.標籤}` : ""}`);

const roster = (await queryAll(DS.roster)).filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: num(p, "座號") })).filter(r => Number.isFinite(r.seat));
const seatOf = new Map(roster.map(r => [r.id, r.seat]));
const labels = new Map([[cur.標籤, cur], ...(prev ? [[prev.標籤, prev]] : [])]);
const allLogs = await queryAll(DS.log);
const rows = allLogs.map(p => ({
  title: anyText(p, "事件描述"), seats: relIds(p, "學生").map(id => seatOf.get(id)).filter(Boolean),
  date: dateOf(p, "日期"), cat: sel(p, "類別"), sign: sel(p, "正負向"), coin: num(p, "金幣影響") ?? 0,
  level: num(p, "程度"), count: num(p, "次數") ?? 1, week: anyText(p, "週次"), year: sel(p, "學年"),
}));
const kindOf = r => WB.test(r.title) ? "寫回" : (TALLY.has(r.title) && !r.level) ? "tally" : (r.level || r.coin) ? "班規" : "其他";
const weekRows = rows.filter(r => labels.has(r.week));
const ledger = await queryAll(DS.bank);

console.log("\n== 0 資料量 ==");
for (const [lab] of labels) {
  const c = {}; weekRows.filter(r => r.week === lab).forEach(r => { c[kindOf(r)] = (c[kindOf(r)] ?? 0) + 1; });
  const neutralAbs = weekRows.filter(r => r.week === lab && /缺席$/.test(r.title) && r.sign === "中性").length;
  console.log(`${lab}：${JSON.stringify(c)}｜缺席列正負向＝中性 ${neutralAbs} 列`);
}

const tallyMap = (lab, act) => {
  const m = new Map();
  weekRows.filter(r => r.week === lab && r.title === act).forEach(r => r.seats.forEach(s => m.set(s, (m.get(s) ?? 0) + r.count)));
  return m;
};
const hwGive = lab => {
  const done = tallyMap(lab, "作業完成");
  if (!done.size) return [];
  const bad = new Set();
  weekRows.filter(r => r.week === lab && r.cat === "作業" && r.sign === "－").forEach(r => r.seats.forEach(s => bad.add(s)));
  return roster.map(r => r.seat).filter(s => done.has(s) && !bad.has(s));
};

console.log("\n== A 打掃未達標 ≥3（③ −5）==");
for (const [lab, w] of labels) {
  const m = tallyMap(lab, "打掃未達標");
  const over = [...m.entries()].filter(([, v]) => v >= 3);
  const paid = ledger.filter(b => new RegExp(`^第${w.週次}週打掃未達標`).test(anyText(b, "事由"))).length;
  console.log(`${lab}：未達標次數 ${fmt(m)}｜≥3 者 ${over.map(([s, v]) => `${s}(${v})`).join("、") || "無"}｜帳本已有「第${w.週次}週打掃未達標」${paid} 筆`);
}

console.log("\n== B 週結寫回紀錄庫預演（本週）==");
{
  const N = cur.週次, end = labelEnd(cur), yr = yearOf(end);
  const over = [...tallyMap(cur.標籤, "打掃未達標").entries()].filter(([, v]) => v >= 3);
  const give = hwGive(cur.標籤);
  const plan = [
    ...over.map(([s, v]) => ({ seat: s, title: `第${N}週打掃未達標（${v} 次）`, cat: "生活技能", sign: "－", coin: -5 })),
    ...give.map(s => ({ seat: s, title: `第${N}週作業完成獎勵`, cat: "作業", sign: "＋", coin: 5 })),
  ];
  console.log(`日期：標籤迄日 ${end}（weeks.json 的「迄」是 ${cur.迄}）｜學年由日期算＝${yr}｜週次＝${cur.標籤}`);
  console.log(`預計寫回：③ ${over.length} 列、④ ${give.length} 列（④ 座號 ${give.join("、") || "無"}）`);
  const key = (t, s, y, w) => `${t}|${s}|${y}|${w}`;
  const existing = new Set();
  rows.forEach(r => r.seats.forEach(s => existing.add(key(r.title, s, r.year, r.week))));
  const hit1 = plan.filter(p => existing.has(key(p.title, p.seat, yr, cur.標籤))).length;
  plan.forEach(p => existing.add(key(p.title, p.seat, yr, cur.標籤)));
  const hit2 = plan.filter(p => existing.has(key(p.title, p.seat, yr, cur.標籤))).length;
  console.log(`防重複鍵（事件描述×學生×學年×週次）：第一次命中既有 ${hit1} 列（應 0）｜假設寫入後重跑命中 ${hit2}/${plan.length} 列（應全數）`);
  const nextYearSame = plan.filter(p => existing.has(key(p.title, p.seat, String(Number(yr) + 1), cur.標籤))).length;
  const noYear = new Set(); rows.forEach(r => r.seats.forEach(s => noYear.add(`${r.title}|${s}|${r.week}`)));
  console.log(`下學年同名週次：含學年的鍵誤判 ${nextYearSame} 列（應 0）`);
  const hwPaid = ledger.filter(b => new RegExp(`^第${N}週作業完成獎勵`).test(anyText(b, "事由")));
  console.log(`帳本已有「第${N}週作業完成獎勵」${hwPaid.length} 筆，其中掛紀錄庫 relation ${hwPaid.filter(b => relIds(b, "紀錄庫").length).length} 筆（本週在施工前入帳，屬正常）`);
}

console.log("\n== C 學習報告推導 vs 週結判定 ==");
for (const [lab, w] of labels) {
  const give = hwGive(lab);
  const paidSeats = new Set();
  ledger.filter(b => new RegExp(`^第${w.週次}週作業完成獎勵`).test(anyText(b, "事由")))
    .forEach(b => relIds(b, "學生").forEach(id => seatOf.has(id) && paidSeats.add(seatOf.get(id))));
  const onlyDerived = give.filter(s => !paidSeats.has(s)), onlyPaid = [...paidSeats].filter(s => !give.includes(s));
  console.log(`${lab}：推導 ④ ${give.length} 人／帳本實發 ${paidSeats.size} 人｜只在推導 ${onlyDerived.join("、") || "無"}｜只在帳本 ${onlyPaid.join("、") || "無"}`);
}

console.log("\n== D 輔導門檻（兩週同類負向 ≥3）==");
{
  const count = (pick) => {
    const m = new Map();
    weekRows.filter(pick).forEach(r => r.seats.forEach(s => {
      const k = `${s}|${r.cat}`; m.set(k, (m.get(k) ?? 0) + 1);
    }));
    return [...m.entries()].filter(([, v]) => v >= 3).map(([k, v]) => `${k.replace("|", "號/")}(${v})`).sort();
  };
  console.log(`舊口徑（所有負向列）：${count(r => r.sign === "－").join("、") || "無"}`);
  console.log(`新口徑（只數班規紀錄＋寫回列）：${count(r => r.sign === "－" && (kindOf(r) === "班規" || kindOf(r) === "寫回")).join("、") || "無"}`);
}

console.log("\n== E ⑤ 班級常規獎勵：班規紀錄連帶扣掉的部分（本週）==");
{
  const tallyDays = new Map(), ruleDays = new Map(), why = {};
  for (const r of weekRows.filter(r => r.week === cur.標籤)) {
    const isT = r.title === "常規未達成";
    const isR = !isT && !WB.test(r.title) && r.coin && r.sign === "－" && (r.cat === "生活指導" || r.cat === "生活技能");
    if (!isT && !isR) continue;
    for (const s of r.seats) {
      const m = isT ? tallyDays : ruleDays;
      if (!m.has(s)) m.set(s, new Set());
      m.get(s).add(r.date);
      if (isR) { const c = CIRCLE.includes(r.title[0]) ? r.title[0] : "其他"; why[c] = (why[c] ?? 0) + 1; }
    }
  }
  const amt = miss => Math.max(0, 5 - miss) + (miss === 0 ? 3 : 0);
  let total = 0; const hurt = new Map();
  for (const r of roster) {
    const t = tallyDays.get(r.seat) ?? new Set(), all = new Set([...t, ...(ruleDays.get(r.seat) ?? [])]);
    const diff = amt(t.size) - amt(all.size);
    if (diff) { hurt.set(r.seat, diff); total += diff; }
  }
  console.log(`只因班規紀錄（非潔牙等常規 tally）而少拿常規獎勵：${hurt.size} 人、共 ${total} 幣｜座號:少拿幣數 ${fmt(hurt)}`);
  console.log(`造成的班規紀錄依班規分：${JSON.stringify(why)}`);
  const paid = ledger.filter(b => new RegExp(`^第${cur.週次}週(班級)?常規獎勵`).test(anyText(b, "事由"))).reduce((a, b) => a + (num(b, "金額") ?? 0), 0);
  console.log(`帳本本週常規獎勵實發 ${paid} 幣`);
}

console.log("\n== F 免打掃券 ==");
{
  const redeem = (await queryAll(DS.redeem)).filter(p => anyText(p, "品項") === "免打掃一次券");
  const used = redeem.filter(p => (num(p, "已使用次數") ?? 0) > 0);
  const absent = new Set();
  rows.filter(r => r.title === "打掃缺席").forEach(r => r.seats.forEach(s => absent.add(`${s}|${r.date}`)));
  const inWeeks = used.filter(p => [...labels.values()].some(w => dateOf(p, "最近使用") >= w.起 && dateOf(p, "最近使用") <= w.迄));
  const overlap = inWeeks.filter(p => absent.has(`${num(p, "座號")}|${dateOf(p, "最近使用")}`));
  const seatMissing = redeem.filter(p => !Number.isFinite(num(p, "座號"))).length;
  console.log(`兌換列 ${redeem.length}｜已使用 ${used.length}｜兩週內使用 ${inWeeks.length}（座號/日期 ${inWeeks.map(p => `${num(p, "座號")}/${dateOf(p, "最近使用")}`).join("、") || "無"}）｜同日也有打掃缺席 ${overlap.length}｜讀不到座號數字的列 ${seatMissing}`);
}
