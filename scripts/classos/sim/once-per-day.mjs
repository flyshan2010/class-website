/**
 * 只讀演練｜同生同日同科舉手只算一筆（lib/once-per-day.mjs）用真資料跑一週
 * ───────────────────────────────────────────────────────────────
 * 不寫任何東西：只 import queryAll（讀），不 import api／updatePage。
 * 可證偽（護欄 §1 U56）：已人工更正的週，「現況」應該 0 組；把更正過的列在**記憶體裡**還原成
 *   修正前（正負向＝＋、金幣 5）再跑，應該恰好抓到那幾筆。兩邊同數字＝沒驗到。
 *
 * 用法（Actions，讀線上 Notion）：
 *   WEEK_LABEL='四上第6週(10/5-10/9)' \
 *   SIM_RESTORE='R01-20261005-20,R01-20261005-12,R01-20261007-10' \
 *   node scripts/classos/sim/once-per-day.mjs
 * 用法（本機，沒有 token）：加 --fixture <pairs.json>；此時沒有帳本，只跑「尚未入帳」的假設。
 *
 * SIM_RESTORE 同時是預期答案：還原後被判重複（unpaid＋overpaid）的事件 id 集合必須等於它，否則 exit 1。
 * ⚠️ PUBLIC repo：只印座號、日期、科目、事件 id、金額，不印姓名與事件描述。
 */
import { readFile } from "node:fs/promises";
import { oncePerDay, pairsOfPage, pairKey } from "../lib/once-per-day.mjs";

const WEEK = String(process.env.WEEK_LABEL || "").trim();
const RESTORE = String(process.env.SIM_RESTORE || "").split(",").map(s => s.trim()).filter(Boolean);
const fx = process.argv.indexOf("--fixture");

let pairs, seatOf, booked = null;
if (fx > 0) {
  const j = JSON.parse(await readFile(process.argv[fx + 1], "utf8"));
  pairs = j.pairs;
  seatOf = new Map(Object.entries(j.seatOf));
  console.log(`📂 fixture：${j.note ?? ""}`);
} else {
  if (!WEEK) { console.error("❌ 缺少 WEEK_LABEL"); process.exit(1); }
  const { queryAll, DS } = await import("../lib/notion.mjs");
  const txt = (p, k) => (p.properties?.[k]?.rich_text ?? []).map(t => t.plain_text).join("");
  seatOf = new Map((await queryAll(DS.roster)).map(p => [p.id, p.properties?.["座號"]?.number]));
  pairs = (await queryAll(DS.log)).filter(p => txt(p, "週次") === WEEK).flatMap(pairsOfPage);
  booked = new Set();
  for (const b of await queryAll(DS.bank)) {
    for (const l of b.properties?.["紀錄庫"]?.relation ?? []) for (const s of b.properties?.["學生"]?.relation ?? []) booked.add(`${l.id}|${s.id}`);
  }
}
console.log(`📝 ${WEEK || "（fixture）"}：${pairs.length} 筆（列×學生）｜還原對照 ${RESTORE.length} 筆`);

const restored = pairs.map(r => RESTORE.includes(r.eid) ? { ...r, sign: "＋", coin: 5 } : r);
const hit = RESTORE.filter(e => pairs.some(r => r.eid === e)).length;
if (hit !== RESTORE.length) { console.error(`❌ SIM_RESTORE 有 ${RESTORE.length - hit} 個事件 id 在這週找不到，對照組不成立`); process.exit(1); }

const tag = r => r.eid || `（無事件id ${String(r.logId).slice(-4)}）`;
function arm(name, rows, bk) {
  const { skip, groups, manual } = oncePerDay(rows, bk);
  const coins = rows.filter(r => skip.has(pairKey(r))).reduce((n, r) => n + r.coin, 0);
  const over = groups.flatMap(g => g.overpaid);
  console.log(`\n── ${name}：重複 ${groups.length} 組｜重複未入帳 ${skip.size} 筆／${coins} 幣（不入帳）｜已重複入帳 ${over.length} 筆／${over.reduce((n, r) => n + r.coin, 0)} 幣（需人工補扣）｜判不出 ${manual.length} 筆`);
  for (const g of groups) {
    console.log(`   座號${seatOf.get(g.stuId) ?? "?"} ${g.date} ${g.subject}｜留 ${tag(g.keep)}` +
      (g.unpaid.length ? `｜不入帳 ${g.unpaid.map(tag).join("、")}` : "") +
      (g.overpaid.length ? `｜已重複入帳 ${g.overpaid.map(tag).join("、")}` : ""));
  }
  return groups.flatMap(g => [...g.unpaid, ...g.overpaid]).map(r => r.eid).sort();
}

const now = arm("A 現況（線上資料原樣）＋尚未入帳假設", pairs, new Set());
const before = arm("B 修正前（記憶體還原）＋尚未入帳假設＝週結前 f29 會怎麼做", restored, new Set());
if (booked) {
  arm("C 現況＋真實帳本", pairs, booked);
  arm("D 修正前（記憶體還原）＋真實帳本＝事後才跑會看到什麼", restored, booked);
}

if (RESTORE.length) {
  const want = [...RESTORE].sort();
  const ok = JSON.stringify(before) === JSON.stringify(want) && now.length === 0;
  console.log(`\n${ok ? "✅" : "❌"} 可證偽檢查：現況 ${now.length} 筆（應 0）｜修正前抓到 [${before.join(", ")}]（應為 [${want.join(", ")}]）`);
  if (!ok) process.exit(1);
}
console.log("🔍 只讀演練：未寫入任何資料");
