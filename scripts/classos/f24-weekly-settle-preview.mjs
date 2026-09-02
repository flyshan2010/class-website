/**
 * f24｜週五週結試算（只試算，不入帳）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-09-02 指示：週五 16:00 自動試算 → 結果停在「待審」→ 看過確認才入帳。
 * 先這樣跑幾輪、確認金額都對，才考慮讓它自動入帳（通用鐵則 1：新流程先手動跑 PDCA）。
 *
 * **本腳本永遠不寫「🏦 班級銀行帳本」**——它只算、只在「📥 任務收件匣」留一筆待審摘要。
 * 真正入帳仍走 Claude Code 對話的 /class-bank 週結（老師說「週結」時）。
 *
 * 週結五項（公式正本＝docs/班級銀行制度設計.md，與 class-bank SKILL 同源）：
 *   ① 職務薪水     名冊「週薪」
 *   ② 獎懲入帳     紀錄庫本週「金幣影響」≠0 且尚未入帳者（鍵＝紀錄id×學生id）
 *   ③ 打掃薪水     份數 × 5 天 × 2 幣（成員座號＋支援座號各算一份）
 *   ④ 午餐工作薪水 固定崗 5 次 × 2 幣；輪值崗只有輪到那週算 5 次 × 2 幣
 *   ⑤ 班級常規獎勵 達成天數 × 1 ＋ 五天全到再 +3（例外管理：有常規未達成紀錄才扣那天）
 * 消費類（購物／兌換／捐款／臨時加減幣）是當天結，不在週結範圍。
 *
 * 午餐輪值輪次 =（該學期週次 −1）% 完整輪替週數 + 1，下學期從第 1 輪重新起算。
 * ⚠️ 模數讀 data/lunch.json 的「完整輪替週數」，**不可寫死 21**——轉學一人就會變。
 *
 * 用法：GitHub Actions →「週五週結試算」（每週五 16:00 自動跑，也可手動）
 *       mode=dry-run 只印不寫收件匣／execute 建立待審任務
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印座號與金額，不印姓名與事件描述。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryAll, api, isExecute, DS } from "./lib/notion.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = async f => JSON.parse(await readFile(path.join(ROOT, "data", f), "utf8"));

const CLEAN_PAY = 2, LUNCH_PAY = 2, ROUTINE_PAY = 1, ROUTINE_FULL = 3, SCHOOL_DAYS = 5;
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const num = (p, k) => p.properties?.[k]?.number ?? null;
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const txt = (p, k) => (p.properties?.[k]?.rich_text ?? []).map(t => t.plain_text).join("");
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
const seatsOf = s => String(s ?? "").split(/[,、，\s]+/).map(x => Number(x)).filter(Number.isFinite);

// ── 本週是哪一週（單一出處：data/weeks.json）────────────────────────
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const weeksFile = await readJSON("weeks.json");
let WEEK = null, TERM_NO = null;
for (const t of weeksFile.學期 ?? []) {
  const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
  if (w) { WEEK = w.標籤; TERM_NO = w.週次; break; }
}
if (!WEEK) { console.log(`🏖️ ${today} 不在任何上課週內（假期），本次不試算。`); process.exit(0); }
const YEAR = String(Number(today.slice(0, 4)) - 1911 - (Number(today.slice(5, 7)) < 8 ? 1 : 0));
console.log(`📅 ${today}｜${WEEK}｜學期第 ${TERM_NO} 週｜學年 ${YEAR}`);

// ── 名冊 ────────────────────────────────────────────────────────
const roster = (await queryAll(DS.roster))
  .filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: num(p, "座號"), pay: num(p, "週薪") ?? 0, job: txt(p, "職務") }))
  .filter(r => Number.isFinite(r.seat))
  .sort((a, b) => a.seat - b.seat);
const seatOf = new Map(roster.map(r => [r.id, r.seat]));
console.log(`👥 在學 ${roster.length} 人`);

// ① 職務薪水 ─────────────────────────────────────────────────────
const noPay = roster.filter(r => !r.pay).map(r => r.seat);
const salary = roster.filter(r => r.pay).reduce((a, r) => a + r.pay, 0);

// ② 獎懲：本週紀錄庫 vs 帳本已入帳（鍵＝紀錄id×學生id，一筆紀錄可掛多人）──
const ledger = await queryAll(DS.bank);
const settled = new Set();
for (const b of ledger) {
  for (const lid of relIds(b, "紀錄庫")) for (const sid of relIds(b, "學生")) settled.add(`${lid}|${sid}`);
}
const logs = (await queryAll(DS.log)).filter(p => txt(p, "週次") === WEEK && num(p, "金幣影響"));
let rewardN = 0, rewardSum = 0;
for (const l of logs) {
  for (const sid of relIds(l, "學生")) {
    if (settled.has(`${l.id}|${sid}`)) continue;
    rewardN++; rewardSum += num(l, "金幣影響");
  }
}

// ③④ 工作分配 ───────────────────────────────────────────────────
const duties = (await queryAll(DS.duties)).filter(p => p.properties?.["顯示"]?.checkbox);
const cleanShares = new Map();          // 座號 → 份數
let fixedLunch = new Set();
for (const d of duties) {
  const type = sel(d, "類型"), zone = sel(d, "區域");
  const members = seatsOf(txt(d, "成員座號")), support = seatsOf(txt(d, "支援座號"));
  if (type === "打掃") {
    for (const s of [...members, ...support]) cleanShares.set(s, (cleanShares.get(s) ?? 0) + 1);
  } else if (type === "午餐" && zone === "午餐固定崗") {
    for (const s of members) fixedLunch.add(s);
  }
}
const cleanTotal = [...cleanShares.values()].reduce((a, b) => a + b, 0) * SCHOOL_DAYS * CLEAN_PAY;
const noClean = roster.filter(r => !cleanShares.has(r.seat)).map(r => r.seat);

// 午餐輪值：輪次由週次算，池＝在學座號扣掉固定崗（與 build-duties.mjs 同一算法）
const lunchJson = await readJSON("lunch.json");
const cycle = Number(lunchJson.完整輪替週數) || (lunchJson.rotation ?? []).length;
const perWeek = Number(lunchJson.每週人數) || 0;
const pool = roster.map(r => r.seat).filter(s => !fixedLunch.has(s));
const round = cycle ? ((TERM_NO - 1) % cycle) + 1 : null;
const rotSeats = (cycle && perWeek)
  ? Array.from({ length: perWeek }, (_, i) => pool[((round - 1) * perWeek + i) % pool.length])
  : [];
const lunchTotal = (fixedLunch.size + rotSeats.length) * SCHOOL_DAYS * LUNCH_PAY;

// ⑤ 班級常規獎勵：例外管理（本週有「常規未達成」負向紀錄才扣那天）────
const ROUTINE_CATS = new Set(["生活指導", "生活技能"]);
const missDays = new Map();             // 座號 → Set(日期)
for (const l of logs) {
  if (sel(l, "正負向") !== "－" || !ROUTINE_CATS.has(sel(l, "類別"))) continue;
  const d = l.properties?.["日期"]?.date?.start;
  for (const sid of relIds(l, "學生")) {
    const s = seatOf.get(sid); if (!s || !d) continue;
    if (!missDays.has(s)) missDays.set(s, new Set());
    missDays.get(s).add(d);
  }
}
let routineTotal = 0;
const routineDetail = [];
for (const r of roster) {
  const miss = missDays.get(r.seat)?.size ?? 0;
  const days = Math.max(0, SCHOOL_DAYS - miss);
  const amt = days * ROUTINE_PAY + (days === SCHOOL_DAYS ? ROUTINE_FULL : 0);
  routineTotal += amt;
  if (miss) routineDetail.push(`座號${r.seat} 少 ${miss} 天`);
}

// ── 報表 ────────────────────────────────────────────────────────
const total = salary + rewardSum + cleanTotal + lunchTotal + routineTotal;
const lines = [
  `【${WEEK} 週結試算】試算於 ${today}，**尚未入帳**`,
  `① 職務薪水　　　${salary} 幣（${roster.length - noPay.length} 人）${noPay.length ? `｜未填週薪：座號 ${noPay.join("、")}` : ""}`,
  `② 獎懲入帳　　　${rewardSum >= 0 ? "+" : ""}${rewardSum} 幣（${rewardN} 筆待入帳）`,
  `③ 打掃薪水　　　${cleanTotal} 幣（${[...cleanShares.values()].reduce((a, b) => a + b, 0)} 份 × 5 天 × ${CLEAN_PAY}）${noClean.length ? `｜無掃區：座號 ${noClean.join("、")}` : ""}`,
  `④ 午餐工作薪水　${lunchTotal} 幣（固定崗 ${fixedLunch.size} 人＋第 ${round} 輪輪值 ${rotSeats.join("、")}）`,
  `⑤ 班級常規獎勵　${routineTotal} 幣${routineDetail.length ? `｜未全勤：${routineDetail.join("、")}` : "（全班全勤）"}`,
  `　　　　　　　　合計 ${total} 幣`,
  `確認無誤 → 在 Claude Code 說「週結」即入帳；有問題就先改資料再說一次。`,
];
console.log("\n" + lines.join("\n"));

if (!isExecute()) { console.log("\n🔍 dry-run：未建立待審任務（要建請用 mode=execute）"); process.exit(0); }

// ── 寫入收件匣（狀態＝待審；不碰帳本）──────────────────────────────
const dup = (await queryAll(DS.inbox)).some(p =>
  (p.properties?.["任務原文"]?.title ?? []).map(t => t.plain_text).join("").includes(`${WEEK} 週結試算`));
if (dup) { console.log(`\n⏭️ 收件匣已有「${WEEK} 週結試算」，不重複建立。`); process.exit(0); }

const r = await api("POST", "/pages", {
  parent: { type: "data_source_id", data_source_id: DS.inbox },
  properties: {
    "任務原文": { title: rt(`${WEEK} 週結試算（自動）`) },
    "狀態": { select: { name: "待審" } },
    "路由ID": { rich_text: rt("R03") },
    "執行紀錄": { rich_text: rt(lines.join("\n")) },
    "學年": { select: { name: YEAR } },
  },
});
if (!r.ok) { console.error(`❌ 建立待審任務失敗：${r.status} ${r.json?.message ?? ""}`); process.exit(1); }
console.log(`\n✅ 已在收件匣建立待審任務（合計 ${total} 幣，等老師確認）`);
