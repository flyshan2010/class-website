/**
 * f36｜更正 R18 掛錯學生的紀錄（一次性，2026-09-25）
 * ───────────────────────────────────────────────────────────────
 * 背景：f35 回溯第 3 週對照（SPEC_R18事件包入庫腳本 §5 第 3 步）發現雲端 routine 把
 *   9/16 座號15 的潔牙兩筆（班規⑦ −5＋常規未達成）掛到座號16 的學生頁。
 *   老師 2026-09-25 裁示：「確認是否確實誤扣，若有，更正」。
 *
 * 做法（照班級 CLAUDE.md U63：錢已動就另開退款／補扣列，不改舊帳）：
 *   ① 紀錄庫兩列的「學生」改回座號15（事件包原文 seat=15）
 *   ② 帳本：原 −5 懲罰金列留著；座號16 另開「調整 +5 退回」、座號15 另開「懲罰金 −5 補扣」
 *      （補扣列掛紀錄庫 relation＝f29 的防重複鍵，以後重跑不會再扣一次）
 *   ③ 第 3 週常規獎勵：依「常規未達成」天數重算兩人應得，與已發金額的差額各開一筆調整
 * 每一步先驗證「確實掛錯／確實扣錯」才動；驗不到就不寫並說明。
 *
 * MODE=dry-run（預設，只查不寫）／execute。
 * ⚠️ PUBLIC repo：只印座號與金額，不印姓名、事件描述、事件id。
 */
import { queryAll, api, isExecute, DS } from "./lib/notion.mjs";

const EXECUTE = isExecute();
const WEEK = "四上第3週(9/14-9/18)";
const W = 3;
const DATE = "2026-09-16";
const EVENT_IDS = ["teeth-20260916-s15-r7b.2", "teeth-20260916-s15-t.常規未達成"];
const RIGHT = 15, WRONG = 16;
const ROUTINE_PAY = 1, ROUTINE_FULL = 3, SCHOOL_DAYS = 5; // 與 f24 相同
const NOTE = "（2026-09-25 更正：9/16 潔牙紀錄原誤掛座號16）";

const rt = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const text = (p, k) => (p.properties?.[k]?.title ?? p.properties?.[k]?.rich_text ?? []).map((t) => t.plain_text).join("");
const rel = (p, k) => (p.properties?.[k]?.relation ?? []).map((r) => r.id);
const num = (p, k) => p.properties?.[k]?.number ?? 0;
const bad = (msg) => { console.log(`❌ ${msg}——不寫入，請人工確認`); process.exit(1); };

console.log(`f36｜模式 ${EXECUTE ? "⚠️ EXECUTE" : "🔍 DRY-RUN"}`);

// 名冊
const roster = (await queryAll(DS.roster)).filter((p) => p.properties?.在學?.checkbox);
const idOf = new Map(roster.map((p) => [p.properties?.座號?.number, p.id]));
const seatOf = new Map(roster.map((p) => [p.id, p.properties?.座號?.number]));
const R = idOf.get(RIGHT), X = idOf.get(WRONG);
if (!R || !X) bad("名冊找不到座號15 或 16");

// ① 紀錄庫兩列：確認目前掛在 16
const dayLogs = await queryAll(DS.log, { filter: { property: "日期", date: { equals: DATE } } });
const targets = dayLogs.filter((p) => EVENT_IDS.includes(text(p, "事件id")));
if (targets.length !== EVENT_IDS.length) bad(`紀錄庫找到 ${targets.length} 列，應為 ${EVENT_IDS.length}`);
for (const p of targets) {
  const seats = rel(p, "學生").map((id) => seatOf.get(id));
  console.log(`紀錄庫列（金幣 ${num(p, "金幣影響")}）目前掛：座號${seats.join("、")}`);
  if (seats.length !== 1 || seats[0] !== WRONG) bad("不是「只掛座號16」，與對照結果不符");
}
const already15 = dayLogs.filter((p) => text(p, "事件描述") === "常規未達成" && rel(p, "學生").includes(R));
console.log(`座號15 在 ${DATE} 另有常規未達成列：${already15.length} 列`);

// ② 帳本：這兩列紀錄產生的帳
const ledger = await queryAll(DS.bank);
const bal = (sid) => ledger.filter((b) => rel(b, "學生").includes(sid)).reduce((a, b) => a + num(b, "金額"), 0);
const fromTargets = ledger.filter((b) => rel(b, "紀錄庫").some((id) => targets.some((t) => t.id === id)));
for (const b of fromTargets) console.log(`帳本列：座號${rel(b, "學生").map((id) => seatOf.get(id)).join("、")} ${num(b, "金額")} 幣（${b.properties?.類型?.select?.name ?? ""}）`);
const wrongFine = fromTargets.filter((b) => rel(b, "學生").includes(X) && num(b, "金額") < 0);
const rightFine = fromTargets.filter((b) => rel(b, "學生").includes(R) && num(b, "金額") < 0);

// ③ 第 3 週常規獎勵：重算
const weekLogs = await queryAll(DS.log, { filter: { property: "週次", rich_text: { equals: WEEK } } });
const miss = (sid, fixed) => {
  const days = new Set();
  for (const l of weekLogs) {
    if (text(l, "事件描述") !== "常規未達成") continue;
    let owners = rel(l, "學生");
    if (fixed && targets.some((t) => t.id === l.id)) owners = [R];
    if (owners.includes(sid)) days.add(l.properties?.日期?.date?.start);
  }
  return days.size;
};
const pay = (m) => { const d = Math.max(0, SCHOOL_DAYS - m); return d * ROUTINE_PAY + (d === SCHOOL_DAYS ? ROUTINE_FULL : 0); };
const paidRoutine = (sid) => ledger.filter((b) => rel(b, "學生").includes(sid) && new RegExp(`^第${W}週(班級)?常規獎勵`).test(text(b, "事由")))
  .reduce((a, b) => a + num(b, "金額"), 0);
const routine = [[RIGHT, R], [WRONG, X]].map(([seat, sid]) => {
  const before = pay(miss(sid, false)), after = pay(miss(sid, true)), paid = paidRoutine(sid);
  console.log(`常規獎勵 座號${seat}：未達成 ${miss(sid, false)}→${miss(sid, true)} 天｜應得 ${before}→${after}｜已發 ${paid}`);
  return { seat, sid, before, after, paid, delta: after - paid };
});

// ── 更正計畫 ──
const plans = [];
if (wrongFine.length && !rightFine.length) {
  const fine = num(wrongFine[0], "金額");
  const b15 = bal(R);
  const amt15 = Math.max(fine, -b15); // 扣至歸零（class-bank 硬性規則 3）
  plans.push({ seat: WRONG, sid: X, amt: -fine, type: "調整", why: `退回：班規⑦潔牙懲罰誤扣${NOTE}`, logId: wrongFine[0].properties.紀錄庫.relation[0].id });
  plans.push({ seat: RIGHT, sid: R, amt: amt15, type: "懲罰金", why: `${text(wrongFine[0], "事由")}${NOTE}${amt15 !== fine ? "(扣至歸零)" : ""}`, logId: wrongFine[0].properties.紀錄庫.relation[0].id });
} else {
  console.log(`帳本：座號16 誤扣列 ${wrongFine.length}、座號15 已扣列 ${rightFine.length} → ⑦ 不需更正`);
}
for (const r of routine) {
  if (!r.paid) { console.log(`常規獎勵 座號${r.seat}：帳本沒有第${W}週常規獎勵列 → 不更正（交老師判斷）`); continue; }
  if (r.paid !== r.before) { console.log(`常規獎勵 座號${r.seat}：已發 ${r.paid} ≠ 當時應得 ${r.before} → 不是這次掛錯造成，不動`); continue; }
  if (r.delta) plans.push({ seat: r.seat, sid: r.sid, amt: r.delta, type: "調整", why: `第${W}週常規獎勵差額${NOTE}` });
}
plans.forEach((p) => console.log(`📝 計畫：座號${p.seat} ${p.amt > 0 ? "+" : ""}${p.amt} 幣（${p.type}）`));
console.log(`📝 計畫：紀錄庫 ${targets.length} 列學生改回座號${RIGHT}`);
if (!EXECUTE) { console.log("🔍 DRY-RUN 結束，未寫入。"); process.exit(0); }

// ── 執行 ──
for (const t of targets) {
  const r = await api("PATCH", `/pages/${t.id}`, { properties: { 學生: { relation: [{ id: R }] } } });
  if (!r.ok) bad(`紀錄庫改學生失敗 HTTP ${r.status}`);
}
for (const p of plans) {
  const r = await api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.bank }, properties: {
    事由: { title: rt(p.why) }, 日期: { date: { start: DATE } }, 週次: { rich_text: rt(WEEK) }, 學年: { select: { name: "115" } },
    學生: { relation: [{ id: p.sid }] }, 類型: { select: { name: p.type } }, 金額: { number: p.amt },
    ...(p.logId ? { 紀錄庫: { relation: [{ id: p.logId }] } } : {}),
  } });
  if (!r.ok) bad(`帳本寫入失敗 座號${p.seat} HTTP ${r.status}`);
  const back = await api("GET", `/pages/${r.json.id}`);
  console.log(`✅ 帳本 座號${p.seat} 回讀金額 ${back.json?.properties?.金額?.number}`);
}
for (const t of targets) {
  const back = await api("GET", `/pages/${t.id}`);
  console.log(`✅ 紀錄庫回讀：座號${(back.json?.properties?.學生?.relation ?? []).map((x) => seatOf.get(x.id)).join("、")}`);
}
