/**
 * f31｜週結薪水類（①職務 ③打掃 ④午餐 ⑤常規獎勵）入帳
 * ───────────────────────────────────────────────────────────────
 * 背景（2026-09-18）：② 獎懲有 f29 可以入帳，①③④⑤ 一直是 Claude Code 用 MCP 逐筆手建
 *   （第2週 160 筆就是這樣進去的）。逐人金額只有 f24 試算算得出來，手建這一段等於
 *   「模型照著報表重打 90 幾筆數字」——U44 明說動錢的事不靠模型心算。
 *
 * 本腳本刻意做成**純寫入器（dumb writer），一行公式都沒有**：
 *   金額由 f24 的「💰 薪水類逐人明細」提供（PAYLOAD），這裡只負責建帳列、防重複、回讀。
 *   公式因此仍然只有 f24 一份正本，不會兩邊各改各的漂掉（U58）。
 *
 * 冪等：鍵＝（事由前綴 × 學生頁 id），與 f24 的防重複判定同一套事由格式：
 *   第N週薪水（職務）／第N週打掃薪水／第N週午餐工作薪水／第N週班級常規獎勵。
 *   已經有同前綴同學生的帳列 → 那個人那一類跳過（不是整類跳過：補漏才補得進來）。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f31-settle-week-salary
 *       week=四上第3週(9/14-9/18)（必填，逐字等於 weeks.json 的「標籤」）
 *       payload={"job":{"1":25,…},"clean":{…},"lunch":{…},"routine":{…}}（必填，座號→金額）
 *       mode=dry-run（預設，只列不寫）／execute（實際入帳）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印座號與金額，不印姓名。
 */
import { queryAll, api, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";
import { readFile } from "node:fs/promises";

const WEEK = String(process.env.WEEK_LABEL || "").trim();
if (!WEEK) {
  console.error("❌ 缺少 week（週次標籤）。例：四上第3週(9/14-9/18)");
  process.exit(1);
}
let PAYLOAD;
try {
  PAYLOAD = JSON.parse(String(process.env.PAYLOAD || "").trim() || "null");
} catch (e) {
  console.error(`❌ payload 不是合法 JSON：${e.message}`);
  process.exit(1);
}
if (!PAYLOAD || typeof PAYLOAD !== "object") {
  console.error('❌ 缺少 payload。格式：{"job":{"1":25},"clean":{},"lunch":{},"routine":{}}');
  process.exit(1);
}

const TERM_NO = Number((WEEK.match(/第(\d+)週/) ?? [])[1]);
if (!Number.isFinite(TERM_NO)) {
  console.error(`❌ 週次標籤解析不出第幾週：${WEEK}`);
  process.exit(1);
}

const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const relIds = (page, name) => (page.properties?.[name]?.relation ?? []).map(r => r.id);
const yearOf = d => String(Number(d.slice(0, 4)) - 1911 - (Number(d.slice(5, 7)) < 8 ? 1 : 0));
const anyText = (p, k) => ((p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? [])).map(t => t.plain_text).join("");

// ── 帳列日期＝該週最後一個上課日（學年由它算，不是今天）──────────
const weeks = JSON.parse(await readFile(new URL("../../data/weeks.json", import.meta.url), "utf8"));
const hit = weeks.學期.flatMap(s => s.週).find(w => w.標籤 === WEEK);
if (!hit) {
  console.error(`❌ weeks.json 找不到這個週次標籤（要逐字相同）：${WEEK}`);
  process.exit(1);
}
const DATE = hit.上課迄;
console.log(`🎯 週次 ${WEEK}｜帳列日期 ${DATE}｜學年 ${yearOf(DATE)}｜模式 ${isExecute() ? "execute（會寫入）" : "dry-run（只列不寫）"}`);

// ── 名冊：座號 → { id, 職務 } ───────────────────────────────────
const roster = (await queryAll(DS.roster))
  .filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({
    id: p.id,
    seat: p.properties?.["座號"]?.number,
    job: anyText(p, "職務") || (p.properties?.["職務"]?.select?.name ?? ""),
  }))
  .filter(r => Number.isFinite(r.seat));
const bySeat = new Map(roster.map(r => [r.seat, r]));
console.log(`👥 在學名冊 ${roster.length} 人`);

// ── 帳本：已入帳鍵＝事由前綴 × 學生 ─────────────────────────────
const KINDS = [
  { key: "job",     prefix: `第${TERM_NO}週薪水（`,       label: "① 職務薪水" },
  { key: "clean",   prefix: `第${TERM_NO}週打掃薪水`,     label: "③ 打掃薪水" },
  { key: "lunch",   prefix: `第${TERM_NO}週午餐工作薪水`, label: "④ 午餐工作薪水" },
  { key: "routine", prefix: `第${TERM_NO}週班級常規獎勵`, label: "⑤ 班級常規獎勵" },
];
const bank = await queryAll(DS.bank);
const booked = new Set();   // `${kind}|${學生頁id}`
for (const b of bank) {
  const subj = anyText(b, "事由");
  const k = KINDS.find(x => subj.startsWith(x.prefix));
  if (!k) continue;
  for (const sid of relIds(b, "學生")) booked.add(`${k.key}|${sid}`);
}
console.log(`🏦 帳本 ${bank.length} 列｜本週薪水類已入帳 ${booked.size} 筆`);

// ── 組出待建帳列（事由的括號說明由金額回推，只是顯示文字）────────
/* 打掃／午餐固定 2 幣一次；常規獎勵＝每天 1 幣，全勤再 +3（f24 的 ROUTINE_PAY／ROUTINE_FULL）。
   回推只影響事由那行字，金額一律原封使用 payload，不重算。 */
const PER_TIME = 2, SCHOOL_DAYS = 5, ROUTINE_FULL = 3;
const subjectOf = (kind, seat, amt) => {
  if (kind === "job")     return `第${TERM_NO}週薪水（${bySeat.get(seat)?.job || "未填職務"}）`;
  if (kind === "clean")   return `第${TERM_NO}週打掃薪水（${amt / PER_TIME} 次 × ${PER_TIME} 幣）`;
  if (kind === "lunch")   return `第${TERM_NO}週午餐工作薪水（${amt / PER_TIME} 次 × ${PER_TIME} 幣）`;
  const days = amt > SCHOOL_DAYS ? amt - ROUTINE_FULL : amt;
  return `第${TERM_NO}週班級常規獎勵（${days} 天 × 1 幣${days === SCHOOL_DAYS ? `＋全勤 ${ROUTINE_FULL} 幣` : ""}）`;
};

const creates = [];
let skipDup = 0, skipOff = 0, skipZero = 0;
for (const k of KINDS) {
  const table = PAYLOAD[k.key] ?? {};
  for (const [seatStr, amtRaw] of Object.entries(table)) {
    const seat = Number(seatStr), amt = Number(amtRaw);
    if (!Number.isInteger(amt)) { console.error(`   ❌ 座號${seat} ${k.label} 金額不是整數：${amtRaw}`); process.exit(1); }
    if (amt === 0) { skipZero++; continue; }
    const r = bySeat.get(seat);
    if (!r) { skipOff++; console.error(`   ⚠️ 座號${seat} 不在在學名冊，略過`); continue; }
    if (booked.has(`${k.key}|${r.id}`)) { skipDup++; continue; }
    creates.push({
      seat, amt, kind: k.key, stuId: r.id,
      props: {
        "事由": { title: rt(subjectOf(k.key, seat, amt)) },
        "日期": { date: { start: DATE } },
        "週次": { rich_text: rt(WEEK) },
        "學年": { select: { name: yearOf(DATE) } },
        "學生": { relation: [{ id: r.id }] },
        "類型": { select: { name: "薪水" } },
        "金額": { number: amt },
      },
    });
  }
}

const sumOf = kind => creates.filter(c => c.kind === kind).reduce((a, c) => a + c.amt, 0);
console.log(`\n📊 待入帳 ${creates.length} 筆／${creates.reduce((a, c) => a + c.amt, 0)} 幣`
  + `｜已入帳略過 ${skipDup} 筆｜非在學略過 ${skipOff} 筆｜金額 0 略過 ${skipZero} 筆`);
for (const k of KINDS) {
  const n = creates.filter(c => c.kind === k.key).length;
  console.log(`   ${k.label}　${n} 筆／${sumOf(k.key)} 幣`);
}

if (!creates.length) { console.log("\n✅ 沒有要入帳的，結束。"); process.exit(0); }
if (!isExecute()) { console.log("\n🔍 dry-run：未寫入任何資料（要寫請用 mode=execute）"); process.exit(0); }

// ── 寫入 ───────────────────────────────────────────────────────
let ok = 0, fail = 0;
await forEachThrottled(creates, async c => {
  const res = await api("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: DS.bank },
    properties: c.props,
  });
  // api() 回的是 { status, ok, json }，不是 Notion 頁物件本身（f29 踩過：判 res?.id 會全報失敗）。
  if (res.ok && res.json?.id) ok++;
  else { fail++; console.error(`   ❌ 座號${c.seat} ${c.amt} 幣寫入失敗（HTTP ${res.status} ${res.json?.code ?? ""}）`); }
});
console.log(`\n✍️ 寫入完成：成功 ${ok} 筆／失敗 ${fail} 筆`);

// ── 回讀驗收（「沒噴錯」不算數，看帳本實際有沒有那一筆）──────────
/* 寫完立刻查，最後一兩筆常常還沒進 Notion 的查詢索引——2026-09-18 首跑就這樣：
   92 筆全部寫成功，回讀卻只看到 91 筆而報「缺 1 組鍵」，等幾秒再查就對了。
   假紅燈有兩種害處，**第二種在 2026-09-18 真的發生了**：
   ① 下一個人會以為要重跑，而重跑就是重複發錢；
   ② **它會誘使人編故事**——看到自己沒預期的狀態，最省力的解釋永遠是「有別人動過」。
      那天 f29 同樣噴假紅燈，結果被寫成「530 幣是不明行動者入的」並列為最優先待辦，
      而答案就在自己幾分鐘前下的 `gh workflow run`、在 `gh run list` 的第一頁。
   所以這裡重試，而且紅燈文案一定要附「下一步怎麼判」。 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bank2, booked2, missing;
for (let attempt = 1; attempt <= 3; attempt++) {
  await sleep(attempt * 4000);
  bank2 = await queryAll(DS.bank);
  booked2 = new Set();
  for (const b of bank2) {
    const subj = anyText(b, "事由");
    const k = KINDS.find(x => subj.startsWith(x.prefix));
    if (!k) continue;
    for (const sid of relIds(b, "學生")) booked2.add(`${k.key}|${sid}`);
  }
  missing = creates.filter(c => !booked2.has(`${c.kind}|${c.stuId}`));
  if (!missing.length) break;
  console.log(`   ⏳ 第 ${attempt} 次回讀還缺 ${missing.length} 組，等索引跟上再查…`);
}
const bankFinal = bank2;
let sum2 = 0, n2 = 0, noYear = 0;
for (const b of bankFinal) {
  const subj = anyText(b, "事由");
  if (!KINDS.some(x => subj.startsWith(x.prefix))) continue;
  n2++; sum2 += b.properties?.["金額"]?.number ?? 0;
  if (!b.properties?.["學年"]?.select?.name) noYear++;
}
console.log(`🔁 回讀：帳本 ${bank.length} → ${bankFinal.length}（＋${bankFinal.length - bank.length}）`
  + `｜本週薪水類 ${n2} 筆／${sum2} 幣｜應有的鍵缺 ${missing.length} 組｜學年為空 ${noYear} 筆`);
if (missing.length || noYear) {
  console.error("❌ 回讀不通過：缺鍵或學年為空，請人工檢查後再處理，不要重跑；再跑一次 dry-run 看「待入帳」是不是 0 筆最快。");
  process.exit(1);
}
console.log("✅ 回讀通過。");
