/**
 * 週結模擬情境（2026-09-11，驗證計分口徑施工）：在本週真實資料上疊加／隱藏資料，餵給 f24 跑一次。
 * 疊加的假資料與隱藏只存在這次行程的記憶體，**不寫入 Notion**。
 *
 *   S0  不動（基準，應重現週結實際入帳數字）
 *   S1  某座號某天「免打掃券使用」＋「打掃缺席」並存 → 打掃次數應只少 1
 *   S2  同一座號同一天只有「免打掃券使用」       → 打掃次數也少 1
 *   S3  週結「入帳後」：某座號 3 次打掃未達標，③／④ 已寫回紀錄庫且帳列掛 relation
 *       → ② 待入帳 0、⑦ 0、⑤ 不因寫回列被扣
 *   S5  週結「入帳前」：隱藏本週 ④／③ 帳列，某座號 3 次打掃未達標、尚未寫回
 *       → ⑥ 全額待入帳、⑦ −5
 *   S4  S5 ＋「寫回紀錄庫後、建帳前中斷」：③ 與 3 位 ④ 已有紀錄列但沒帳列
 *       → ② 接手這 4 筆、⑥／⑦ 排除這幾位，「本次實際待入帳」應與 S5 相同（沒有重複算）
 *
 * ⚠️ PUBLIC repo：只印座號與日期。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as real from "../lib/notion.mjs";

const DS = real.DS;
const SC = (process.env.SIM_SCENARIO ?? "S0").trim();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const num = (p, k) => p.properties?.[k]?.number ?? null;
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const txt = (p, k) => (p.properties?.[k]?.rich_text ?? []).map(t => t.plain_text).join("");
const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");
const titleOf = p => anyText(p, "事件描述");
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
const seatsOf = s => String(s ?? "").split(/[,、，\s]+/)
  .map(x => x.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0);
const T = s => [{ plain_text: s, text: { content: s } }];
let seq = 0;
const fakeId = () => `00000000-5151-4000-8000-${String(++seq).padStart(12, "0")}`;

const logPage = ({ title, week, sid, date, cat, sign, coin = 0, level = null, count = 1 }) => ({
  id: fakeId(),
  properties: {
    事件描述: { title: T(title) }, 週次: { rich_text: T(week) }, 學生: { relation: [{ id: sid }] },
    日期: { date: { start: date } }, 類別: { select: { name: cat } }, 正負向: { select: { name: sign } },
    金幣影響: { number: coin }, 程度: { number: level }, 次數: { number: count },
  },
});
const ledgerPage = ({ reason, date, amount, sid, logId }) => ({
  id: fakeId(),
  properties: {
    事由: { title: T(reason) }, 日期: { date: { start: date } }, 金額: { number: amount },
    學生: { relation: [{ id: sid }] }, 紀錄庫: { relation: [{ id: logId }] },
  },
});
const redeemPage = ({ seat, date }) => ({
  id: fakeId(),
  properties: {
    品項: { rich_text: T("免打掃一次券") }, 已使用次數: { number: 1 },
    最近使用: { date: { start: date } }, 座號: { number: seat },
  },
});

async function build() {
  const out = { log: [], bank: [], redeem: [], dropBank: null };
  if (SC === "S0") return out;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const weeks = JSON.parse(await readFile(path.join(ROOT, "data", "weeks.json"), "utf8"));
  let wk = null;
  for (const t of weeks.學期 ?? []) {
    const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
    if (w) { wk = w; break; }
  }
  if (!wk) return out;
  const N = wk.週次;
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(`${wk.起}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const lastDay = days[4];
  const roster = (await real.queryAll(DS.roster))
    .filter(p => p.properties?.["在學"]?.checkbox)
    .map(p => ({ id: p.id, seat: num(p, "座號") })).filter(r => Number.isFinite(r.seat));
  const idOf = new Map(roster.map(r => [r.seat, r.id]));
  const seatOf = new Map(roster.map(r => [r.id, r.seat]));
  const cleaners = [...new Set((await real.queryAll(DS.duties))
    .filter(d => d.properties?.["顯示"]?.checkbox && sel(d, "類型") === "打掃")
    .flatMap(d => seatsOf(txt(d, "成員座號"))))].filter(s => idOf.has(s)).sort((a, b) => a - b);
  const weekLogs = (await real.queryAll(DS.log)).filter(p => txt(p, "週次") === wk.標籤);
  const mine = (p, seat) => relIds(p, "學生").some(id => seatOf.get(id) === seat);
  const dateOf = p => (p.properties?.["日期"]?.date?.start ?? "").slice(0, 10);
  // 與 f24 ⑤ 同一條判準：那天是否已經算「常規沒達成」
  const missOn = (seat, day) => weekLogs.some(p => mine(p, seat) && dateOf(p) === day && titleOf(p) === "常規未達成");

  let X = null, D = null;
  for (const s of cleaners) {
    D = days.slice(1).find(d => !weekLogs.some(p => titleOf(p) === "打掃缺席" && dateOf(p) === d && mine(p, s)));
    if (D) { X = s; break; }
  }
  if (SC === "S1" || SC === "S2") {
    out.redeem.push(redeemPage({ seat: X, date: D }));
    if (SC === "S1") out.log.push(logPage({ title: "打掃缺席", week: wk.標籤, sid: idOf.get(X), date: D, cat: "生活技能", sign: "中性" }));
    console.log(`🧪 情境 ${SC}：座號 ${X} 於 ${D} ` +
      (SC === "S1" ? "同時有「免打掃券使用」與「打掃缺席」（應只少算 1 次）" : "只有「免打掃券使用」（應少算 1 次）"));
    return out;
  }

  // S3／S4／S5：挑一位本週沒有未達標、且最後上課日沒被扣常規獎勵的打掃成員（這樣 ⑤ 若被寫回列誤扣才看得出來）
  const Y = cleaners.find(s => s !== X && !weekLogs.some(p => titleOf(p) === "打掃未達標" && mine(p, s)) && !missOn(s, lastDay));
  for (const d of days.slice(0, 3)) {
    out.log.push(logPage({ title: "打掃未達標", week: wk.標籤, sid: idOf.get(Y), date: d, cat: "生活技能", sign: "－" }));
  }
  const hwBad = new Set(), hwDone = new Set();
  for (const l of weekLogs) {
    const seats = relIds(l, "學生").map(id => seatOf.get(id)).filter(Boolean);
    if (sel(l, "類別") === "作業" && sel(l, "正負向") === "－") seats.forEach(s => hwBad.add(s));
    if (titleOf(l) === "作業完成") seats.forEach(s => hwDone.add(s));
  }
  const give = roster.map(r => r.seat).filter(s => hwDone.has(s) && !hwBad.has(s));
  const w3 = () => logPage({ title: `第${N}週打掃未達標（3 次）`, week: wk.標籤, sid: idOf.get(Y), date: lastDay, cat: "生活技能", sign: "－", coin: -5, level: 1, count: 3 });
  const w4 = s => logPage({ title: `第${N}週作業完成獎勵`, week: wk.標籤, sid: idOf.get(s), date: lastDay, cat: "作業", sign: "＋", coin: 5, level: 1 });

  if (SC === "S3") {
    const r3 = w3(); out.log.push(r3);
    out.bank.push(ledgerPage({ reason: `第${N}週打掃未達標（3 次）`, date: lastDay, amount: -5, sid: idOf.get(Y), logId: r3.id }));
    for (const s of give) {
      const r4 = w4(s); out.log.push(r4);
      out.bank.push(ledgerPage({ reason: `第${N}週作業完成獎勵`, date: lastDay, amount: 5, sid: idOf.get(s), logId: r4.id }));
    }
    console.log(`🧪 情境 S3（入帳後）：座號 ${Y} 3 次打掃未達標（${lastDay} 原本有拿常規獎勵）；③ 1 列＋④ ${give.length} 列已寫回，帳列皆掛 relation`);
  }
  if (SC === "S5" || SC === "S4") {
    out.dropBank = new RegExp(`^第${N}週(作業完成獎勵|打掃未達標)`);
    if (SC === "S4") {
      out.log.push(w3());
      give.slice(0, 3).forEach(s => out.log.push(w4(s)));
    }
    console.log(`🧪 情境 ${SC}（入帳前）：隱藏本週 ④ 帳列；座號 ${Y} 3 次打掃未達標` +
      (SC === "S4" ? `；已寫回但未建帳：③ 座號 ${Y}、④ 座號 ${give.slice(0, 3).join("、")}` : "；尚未寫回"));
  }
  return out;
}

let ctx = null;
export async function inject(dsId, rows) {
  if (SC === "S0") return rows;
  ctx ??= build();
  const c = await ctx;
  if (dsId === DS.log) return rows.concat(c.log);
  if (dsId === DS.bank) {
    const kept = c.dropBank ? rows.filter(b => !c.dropBank.test(anyText(b, "事由"))) : rows;
    return kept.concat(c.bank);
  }
  if (dsId === DS.redeem) return rows.concat(c.redeem);
  return rows;
}
