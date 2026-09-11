/**
 * 週結模擬情境（2026-09-11，驗證計分口徑施工）：在本週真實資料上疊加假資料，餵給 f24 跑一次。
 * 假資料只存在這次行程的記憶體，**不寫入 Notion**。
 *
 *   S0   不疊加（基準，應重現週結實際入帳數字）
 *   S1   某座號某天「免打掃券使用」＋「打掃缺席」並存 → 打掃次數應只少 1
 *   S2   同一座號同一天只有「免打掃券使用」       → 打掃次數也少 1
 *   S3N  某座號本週 3 次「打掃未達標」（不寫回，對照組）
 *   S3   S3N ＋週結寫回：③ 紀錄列＋掛 relation 帳列、④ 作業完成獎勵紀錄列＋帳列
 *        → 與 S3N 比：② 待入帳不變、⑤ 常規獎勵不變
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
const titleOf = p => (p.properties?.["事件描述"]?.title ?? []).map(t => t.plain_text).join("");
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
  const out = { log: [], bank: [], redeem: [] };
  if (SC === "S0") return out;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const weeks = JSON.parse(await readFile(path.join(ROOT, "data", "weeks.json"), "utf8"));
  let wk = null;
  for (const t of weeks.學期 ?? []) {
    const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
    if (w) { wk = w; break; }
  }
  if (!wk) return out;
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
  }
  if (SC === "S3" || SC === "S3N") {
    const Y = cleaners.find(s => s !== X && !weekLogs.some(p => titleOf(p) === "打掃未達標" && mine(p, s)));
    for (const d of days.slice(0, 3)) {
      out.log.push(logPage({ title: "打掃未達標", week: wk.標籤, sid: idOf.get(Y), date: d, cat: "生活技能", sign: "－" }));
    }
    console.log(`🧪 情境 ${SC}：座號 ${Y} 本週加 3 次「打掃未達標」` + (SC === "S3" ? "，並寫回 ③／④ 紀錄列＋掛 relation 的帳列" : "（不寫回，對照組）"));
    if (SC === "S3") {
      const N = wk.週次;
      const w3 = logPage({ title: `第${N}週打掃未達標（3 次）`, week: wk.標籤, sid: idOf.get(Y), date: lastDay, cat: "生活技能", sign: "－", coin: -5, level: 1, count: 3 });
      out.log.push(w3);
      out.bank.push(ledgerPage({ reason: w3.properties.事件描述.title[0].plain_text, date: lastDay, amount: -5, sid: idOf.get(Y), logId: w3.id }));
      const hwBad = new Set(), hwDone = new Set();
      for (const l of weekLogs) {
        const seats = relIds(l, "學生").map(id => seatOf.get(id)).filter(Boolean);
        if (sel(l, "類別") === "作業" && sel(l, "正負向") === "－") seats.forEach(s => hwBad.add(s));
        if (titleOf(l) === "作業完成") seats.forEach(s => hwDone.add(s));
      }
      const give = roster.map(r => r.seat).filter(s => hwDone.has(s) && !hwBad.has(s));
      for (const s of give) {
        const w4 = logPage({ title: `第${N}週作業完成獎勵`, week: wk.標籤, sid: idOf.get(s), date: lastDay, cat: "作業", sign: "＋", coin: 5, level: 1 });
        out.log.push(w4);
        out.bank.push(ledgerPage({ reason: `第${N}週作業完成獎勵`, date: lastDay, amount: 5, sid: idOf.get(s), logId: w4.id }));
      }
      console.log(`🧪 寫回列：③ 1 列（座號 ${Y}）、④ ${give.length} 列；帳列同數，皆掛紀錄庫 relation`);
    }
  }
  return out;
}

let ctx = null;
export async function inject(dsId, rows) {
  if (SC === "S0") return rows;
  ctx ??= build();
  const c = await ctx;
  if (dsId === DS.log) return rows.concat(c.log);
  if (dsId === DS.bank) return rows.concat(c.bank);
  if (dsId === DS.redeem) return rows.concat(c.redeem);
  return rows;
}
