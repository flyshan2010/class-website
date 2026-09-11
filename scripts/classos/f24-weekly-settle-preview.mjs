/**
 * f24｜週五週結試算（只試算，不入帳）
 * ───────────────────────────────────────────────────────────────
 * 老師 2026-09-02 指示：週五 16:00 自動試算 → 結果停在「待審」→ 看過確認才入帳。
 * 先這樣跑幾輪、確認金額都對，才考慮讓它自動入帳（通用鐵則 1：新流程先手動跑 PDCA）。
 *
 * **本腳本永遠不寫「🏦 班級銀行帳本」**——它只算、只在「📥 任務收件匣」留一筆待審摘要。
 * 真正入帳仍走 Claude Code 對話的 /class-bank 週結（老師說「週結」時）。
 *
 * 週結六項（公式正本＝docs/班級銀行制度設計.md，與 class-bank SKILL 同源）：
 *   ① 職務薪水     名冊「週薪」
 *   ② 獎懲入帳     紀錄庫本週「金幣影響」≠0 且尚未入帳者（鍵＝紀錄id×學生id）
 *   ③ 打掃薪水     每人 max(0, 份數×5 ＋ 打掃支援 − 打掃缺席 − 打掃未達標 − 免打掃券使用) × 2 幣
 *                  （免打掃券：同日已記打掃缺席就不重扣；2026-09-10 SPEC_兌換條件自動把關 §4）
 *                  （與 class-bank SKILL 同一條公式；固定支援 2026-09-10 廢止，支援只看當天指派）
 *   ④ 午餐工作薪水 固定崗 5 次 × 2 幣；輪值崗只有輪到那週算 5 次 × 2 幣
 *   ⑤ 班級常規獎勵 達成天數 × 1 ＋ 五天全到再 +3（例外管理：有常規未達成紀錄才扣那天）
 *   ⑥ 作業完成獎勵 本週無作業類負向紀錄、且至少 1 天有「作業完成」tally → +5（一週一筆；本週無該 tally 一律不給）
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
import { queryAll, api, updatePage, isExecute, DS } from "./lib/notion.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = async f => JSON.parse(await readFile(path.join(ROOT, "data", f), "utf8"));

const CLEAN_PAY = 2, LUNCH_PAY = 2, ROUTINE_PAY = 1, ROUTINE_FULL = 3, SCHOOL_DAYS = 5;
/* ⑤ 班級常規獎勵的總開關（2026-09-04 老師裁示：先關）。
   ⑤ 採「例外管理」——預設全員達成，只有記到未達成才扣那天。這在**還沒開始追蹤常規**的週次
   會變成「發了一週沒人在看的全勤獎」（四上第1週就發生：22 人全勤 +8、5 人是被不相關的
   生活指導負向紀錄扣到，兩邊都不是常規觀察的結果）。
   ▶ 開始逐日追蹤常規那一週，把這行改成 true 即可，其餘公式不用動。 */
const ROUTINE_ENABLED = true;   // 2026-09-11 老師裁示：四上第2週起開始發（常規檢核台已逐日記潔牙）
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const num = (p, k) => p.properties?.[k]?.number ?? null;
const sel = (p, k) => p.properties?.[k]?.select?.name ?? "";
const txt = (p, k) => (p.properties?.[k]?.rich_text ?? []).map(t => t.plain_text).join("");
const relIds = (p, k) => (p.properties?.[k]?.relation ?? []).map(r => r.id);
// ⚠️ 一定要先濾掉空字串再轉數字：Number("") 是 0 而不是 NaN，
//    空的「支援座號」會變成一位不存在的「座號 0」，整批多算份數（2026-09-02 第一次試算就踩到）。
const seatsOf = s => String(s ?? "").split(/[,、，\s]+/)
  .map(x => x.trim()).filter(Boolean)
  .map(Number).filter(n => Number.isInteger(n) && n > 0);

// ── 本週是哪一週（單一出處：data/weeks.json）────────────────────────
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
const weeksFile = await readJSON("weeks.json");
let WEEK = null, TERM_NO = null, WEEK_FROM = null, WEEK_TO = null;
for (const t of weeksFile.學期 ?? []) {
  const w = (t.週 ?? []).find(w => (today >= w.起 && today <= w.迄) || w.預排日?.includes(today));
  if (w) { WEEK = w.標籤; TERM_NO = w.週次; WEEK_FROM = w.起; WEEK_TO = w.迄; break; }
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
const weekLogs = (await queryAll(DS.log)).filter(p => txt(p, "週次") === WEEK);
const logs = weekLogs.filter(p => num(p, "金幣影響"));
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
  const members = seatsOf(txt(d, "成員座號"));
  if (type === "打掃") {
    for (const s of members) cleanShares.set(s, (cleanShares.get(s) ?? 0) + 1);
  } else if (type === "午餐" && zone === "午餐固定崗") {
    for (const s of members) fixedLunch.add(s);
  }
}
// 例外次數：紀錄庫本週事件描述「逐字等於」撈取鍵（class-manager 工作檢核台送出的 tally），按學生逐人累計
const titleOf = p => (p.properties?.["事件描述"]?.title ?? []).map(t => t.plain_text).join("");
const tallyBySeat = act => {
  const m = new Map();
  for (const p of weekLogs.filter(p => titleOf(p) === act)) {
    for (const sid of relIds(p, "學生")) {
      const s = seatOf.get(sid); if (!s) continue;
      m.set(s, (m.get(s) ?? 0) + (num(p, "次數") ?? 1));
    }
  }
  return m;
};
const cleanSup = tallyBySeat("打掃支援"), cleanAbs = tallyBySeat("打掃缺席"), cleanBad = tallyBySeat("打掃未達標");
const sumMap = m => [...m.values()].reduce((a, b) => a + b, 0);
const supportTimes = sumMap(cleanSup), absentTimes = sumMap(cleanAbs), badTimes = sumMap(cleanBad);
// 🧹 免打掃一次券：使用那天沒有打掃薪水（SPEC_兌換條件自動把關 §4），老師不必再到檢核台點 ✗。
// 讀 🛒 兌換申請「最近使用」落在本週、且「已使用次數」>0（老師撤銷後會變 0，不算）的券。
// 同一天老師又點了 ✗ 未到（紀錄庫「打掃缺席」同座號同日期）→ 那次已經少算，不重扣。
const absentDay = new Set();
for (const p of weekLogs.filter(p => titleOf(p) === "打掃缺席")) {
  const d = (p.properties?.["日期"]?.date?.start ?? "").slice(0, 10);
  for (const sid of relIds(p, "學生")) { const s = seatOf.get(sid); if (s && d) absentDay.add(`${s}|${d}`); }
}
const cleanFree = new Map();
let freeTimes = 0, freeDup = 0;
for (const t of await queryAll(DS.redeem, { filter: { and: [
  { property: "品項", rich_text: { equals: "免打掃一次券" } },
  { property: "已使用次數", number: { greater_than: 0 } },
  { property: "最近使用", date: { on_or_after: WEEK_FROM } },
  { property: "最近使用", date: { on_or_before: WEEK_TO } },
] } })) {
  const s = num(t, "座號"), d = (t.properties?.["最近使用"]?.date?.start ?? "").slice(0, 10);
  if (!s || !d) continue;
  if (absentDay.has(`${s}|${d}`)) { freeDup++; continue; }
  cleanFree.set(s, (cleanFree.get(s) ?? 0) + 1); freeTimes++;
}
// 逐人算、每人下限 0：缺席扣到負數不能拿去抵別人的支援
const cleanSeats = new Set([...cleanShares.keys(), ...cleanSup.keys()]);
let cleanTimes = 0;
for (const s of cleanSeats) {
  cleanTimes += Math.max(0, (cleanShares.get(s) ?? 0) * SCHOOL_DAYS + (cleanSup.get(s) ?? 0)
    - (cleanAbs.get(s) ?? 0) - (cleanBad.get(s) ?? 0) - (cleanFree.get(s) ?? 0));
}
const cleanTotal = cleanTimes * CLEAN_PAY;
// 驗算用明細（只印座號與份數，不印姓名）——打掃份數算錯就是有人少領錢，一定要看得見
console.log(`🧹 打掃列 ${duties.filter(d => sel(d, "類型") === "打掃").length} 組｜份數分布：`
  + [...cleanShares.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}:${n}`).join(" "));
console.log(`🍱 午餐固定崗座號：${[...fixedLunch].sort((a, b) => a - b).join("、")}`);
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
// 午餐例外：檢核台的「午餐支援／午餐缺席」tally（2026-09-11 補，原本只算基準，缺席也照發）
const lunchSup = tallyBySeat("午餐支援"), lunchAbs = tallyBySeat("午餐缺席");
const lunchSeats = new Set([...fixedLunch, ...rotSeats, ...lunchSup.keys()]);
let lunchTimes = 0;
for (const s of lunchSeats) {
  const base = (fixedLunch.has(s) || rotSeats.includes(s)) ? SCHOOL_DAYS : 0;
  lunchTimes += Math.max(0, base + (lunchSup.get(s) ?? 0) - (lunchAbs.get(s) ?? 0));
}
const lunchTotal = lunchTimes * LUNCH_PAY;

// ⑤ 班級常規獎勵：例外管理（本週有「常規未達成」負向紀錄才扣那天）────
const ROUTINE_CATS = new Set(["生活指導", "生活技能"]);
const missDays = new Map();             // 座號 → Set(日期)
// 檢核台的「常規未達成」tally 金幣是 0，不在 logs 裡——要從 weekLogs 撈，否則潔牙沒做也照發全勤（2026-09-11 補）
for (const l of weekLogs) {
  const isTally = titleOf(l) === "常規未達成";
  if (!isTally && !(num(l, "金幣影響") && sel(l, "正負向") === "－" && ROUTINE_CATS.has(sel(l, "類別")))) continue;
  const d = l.properties?.["日期"]?.date?.start;
  for (const sid of relIds(l, "學生")) {
    const s = seatOf.get(sid); if (!s || !d) continue;
    if (!missDays.has(s)) missDays.set(s, new Set());
    missDays.get(s).add(d);
  }
}
let routineTotal = 0;
const routineDetail = [];
for (const r of (ROUTINE_ENABLED ? roster : [])) {
  const miss = missDays.get(r.seat)?.size ?? 0;
  const days = Math.max(0, SCHOOL_DAYS - miss);
  const amt = days * ROUTINE_PAY + (days === SCHOOL_DAYS ? ROUTINE_FULL : 0);
  routineTotal += amt;
  if (miss) routineDetail.push(`座號${r.seat} 少 ${miss} 天`);
}

// ⑥ 作業完成獎勵：看全週一次給（class-bank SKILL 2026-09-06 定案，2026-09-11 補進試算）──
// 判準＝本週沒有作業類負向紀錄（類別＝作業、正負向＝－，如 ④作業缺交）且至少 1 天有 `作業完成` tally → +5，一週一筆。
// 本週一筆 `作業完成` tally 都沒有＝老師沒用檢核台清點作業，不是全班沒交——一律不給。
const HW_PAY = 5;
const hwBad = new Set();
for (const l of weekLogs) {
  if (sel(l, "類別") !== "作業" || sel(l, "正負向") !== "－") continue;
  for (const sid of relIds(l, "學生")) { const s = seatOf.get(sid); if (s) hwBad.add(s); }
}
const hwDone = tallyBySeat("作業完成");
const hwGive = hwDone.size ? roster.filter(r => hwDone.has(r.seat) && !hwBad.has(r.seat)).map(r => r.seat) : [];
const hwNo = hwDone.size ? roster.map(r => r.seat).filter(s => !hwGive.includes(s)) : [];
const hwTotal = hwGive.length * HW_PAY;

// ── 防重複：①③④⑤ 本週是否已經入過帳（2026-09-04 新增）────────────
/* ② 靠「紀錄id×學生id」防重複，①③④⑤ 原本完全沒有防線——只要公式跑得出來就照列，
   於是 09-04 手動發完薪水後，同日的試算又把同一筆 1115 幣列成「尚未入帳」。
   照著再入一次就是全班薪水發兩次，而且帳本不會有任何錯誤訊息。
   判定鍵＝帳本「事由」開頭的「第N週…」（入帳端寫死的格式），只認本學期第 TERM_NO 週。 */
/* 只看最近 7 天的帳列——「第1週薪水」下學期還會再出現一次（四下第1週），
   單靠事由字串會誤判成已入帳而整週不發薪。 */
const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
/* 帳本的「事由」是 title 不是 rich_text，txt() 讀不到（首版就栽在這裡，
   ⚠️ 完全不會報錯，只是防重複整條失效）。兩種都讀。 */
const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");
const paidOf = (re) => {
  const hit = ledger.filter(b => re.test(anyText(b, "事由"))
    && (b.properties?.["日期"]?.date?.start ?? "") >= since);
  return { n: hit.length, sum: hit.reduce((a, b) => a + (num(b, "金額") ?? 0), 0) };
};
const W = TERM_NO;
const paid = {
  job: paidOf(new RegExp(`^第${W}週薪水（`)),
  clean: paidOf(new RegExp(`^第${W}週打掃薪水`)),
  lunch: paidOf(new RegExp(`^第${W}週午餐工作薪水`)),
  routine: paidOf(new RegExp(`^第${W}週(班級)?常規獎勵`)),
  hw: paidOf(new RegExp(`^第${W}週作業完成獎勵`)),
};
const mark = (p) => p.n ? `　⚠️ **已入帳 ${p.sum} 幣（${p.n} 筆），本次不重複計**` : "";

// ── 報表 ────────────────────────────────────────────────────────
const total = salary + rewardSum + cleanTotal + lunchTotal + routineTotal + hwTotal;
// 實際還要入帳的＝扣掉已入過帳的那幾項（②本來就只算未入帳的）
const due = (paid.job.n ? 0 : salary) + rewardSum + (paid.clean.n ? 0 : cleanTotal)
  + (paid.lunch.n ? 0 : lunchTotal) + (paid.routine.n ? 0 : routineTotal) + (paid.hw.n ? 0 : hwTotal);
const lines = [
  `【${WEEK} 週結試算】試算於 ${today}，**尚未入帳**`,
  `① 職務薪水　　　${salary} 幣（${roster.length - noPay.length} 人）${noPay.length ? `｜未填週薪：座號 ${noPay.join("、")}` : ""}${mark(paid.job)}`,
  `② 獎懲入帳　　　${rewardSum >= 0 ? "+" : ""}${rewardSum} 幣（${rewardN} 筆待入帳）`,
  `③ 打掃薪水　　　${cleanTotal} 幣（${cleanTimes} 次 × ${CLEAN_PAY}＝${[...cleanShares.values()].reduce((a, b) => a + b, 0)} 份×5 ＋ 支援 ${supportTimes} − 缺席 ${absentTimes} − 未達標 ${badTimes} − 免打掃券 ${freeTimes}${freeDup ? `（另 ${freeDup} 次同日已記缺席，不重扣）` : ""}）${noClean.length ? `｜無掃區：座號 ${noClean.join("、")}` : ""}${mark(paid.clean)}`,
  `④ 午餐工作薪水　${lunchTotal} 幣（${lunchTimes} 次 × ${LUNCH_PAY}＝固定崗 ${fixedLunch.size} 人＋第 ${round} 輪輪值 ${rotSeats.join("、")}，支援 ${sumMap(lunchSup)} − 缺席 ${sumMap(lunchAbs)}）${mark(paid.lunch)}`,
  ROUTINE_ENABLED
    ? `⑤ 班級常規獎勵　${routineTotal} 幣${routineDetail.length ? `｜未全勤：${routineDetail.join("、")}` : "（全班全勤）"}${mark(paid.routine)}`
    : `⑤ 班級常規獎勵　**本週不計**（尚未開始逐日追蹤常規；要開啟改 f24 的 ROUTINE_ENABLED）`,
  hwDone.size
    ? `⑥ 作業完成獎勵　${hwTotal} 幣（${hwGive.length} 人）${hwNo.length ? `｜不給：座號 ${hwNo.join("、")}` : ""}${mark(paid.hw)}`
    : `⑥ 作業完成獎勵　0 幣（本週無作業完成 tally，不給）${mark(paid.hw)}`,
  `　　　　　　　　合計 ${total} 幣`
  + (due === total ? "" : `\n　　　　　　　　**本次實際待入帳 ${due} 幣**（其餘已入帳，見上方 ⚠️）`),
  `確認無誤 → 在 Claude Code 說「週結」即入帳（**只入「待入帳」的部分**）；有問題就先改資料再說一次。`,
];
console.log("\n" + lines.join("\n"));

if (!isExecute()) { console.log("\n🔍 dry-run：未建立待審任務（要建請用 mode=execute）"); process.exit(0); }

// ── 寫入收件匣（狀態＝待審；不碰帳本）──────────────────────────────
/* 同一週已有待審的試算就「刷新」它，不要跳過也不要疊第二筆：
   跳過會讓週五排程沿用幾天前的舊金額（獎懲每天都在長），疊第二筆則是兩張單子要對。 */
const prev = (await queryAll(DS.inbox)).find(p =>
  (p.properties?.["任務原文"]?.title ?? []).map(t => t.plain_text).join("").includes(`${WEEK} 週結試算`)
  && (p.properties?.["狀態"]?.select?.name ?? "") === "待審");
if (prev) {
  const u = await updatePage(prev.id, {
    "任務原文": { title: rt(`${WEEK} 週結試算（自動・${today} 更新）`) },
    "執行紀錄": { rich_text: rt(lines.join("\n")) },
  });
  if (!u.ok) { console.error(`❌ 刷新待審任務失敗：${u.status} ${u.json?.message ?? ""}`); process.exit(1); }
  console.log(`\n♻️ 已刷新收件匣既有的待審試算（合計 ${total} 幣）`);
  process.exit(0);
}

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
