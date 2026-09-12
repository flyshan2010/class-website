/**
 * f29｜補結某一週的獎懲（只付錢，不改來源列）
 * ───────────────────────────────────────────────────────────────
 * 背景（2026-09-12）：回溯試算第1週跑出「② 獎懲 +420 幣／54 筆待入帳」。
 *   一度以為是「已發但帳本列沒掛紀錄庫 relation 的舊帳」被防重複鍵誤判，
 *   加診斷後確認**不是**：第1週帳本 494 筆獎懲列全部都有掛 relation，
 *   而待入帳是「全班每個人都有」（21 人 +15、3 人 +10、3 人 +25＝420 幣），
 *   形態＝**2～3 則全班性獎勵整批沒入帳**（U41：一列掛多人時，漏的是整列或第二位以後）。
 *   老師 2026-09-12 裁示補發。
 *
 * 為什麼不直接跑 f23：f23 是「開學補結」一次性腳本，`date >= 2026-08-28` **沒有上限**，
 *   而且會把掃到的來源列「週次」正規化成第1週——今天再跑會把第2、3 週的資料改壞。
 *   f29 因此改成：**以「週次」欄為準圈定範圍、只建帳本列、一個字都不動紀錄庫**。
 *
 * 冪等：鍵＝（紀錄庫頁 id × 學生頁 id）。一筆紀錄可掛多位學生（共同表現），
 *       只用紀錄 id 會讓第二位以後被靜默漏掉——這次要補的就是那種漏。
 * 扣至歸零（class-bank 硬性規則 3）：懲罰金絕對值 > 當下餘額時只記 −餘額，事由末尾註「(扣至歸零)」。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f29-settle-week-rewards
 *       week=四上第1週(8/31-9/4)（必填，逐字等於 weeks.json 的「標籤」）
 *       mode=dry-run（預設，只列不寫）／execute（實際入帳）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印座號與金額，不印姓名與事件描述。
 */
import { queryAll, api, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";

const WEEK = String(process.env.WEEK_LABEL || "").trim();
if (!WEEK) {
  console.error("❌ 缺少 week（週次標籤）。例：四上第1週(8/31-9/4)");
  process.exit(1);
}
const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const relIds = (page, name) => (page.properties?.[name]?.relation ?? []).map(r => r.id);
const yearOf = d => String(Number(d.slice(0, 4)) - 1911 - (Number(d.slice(5, 7)) < 8 ? 1 : 0));

console.log(`🎯 補結週次：${WEEK}｜模式 ${isExecute() ? "execute（會寫入）" : "dry-run（只列不寫）"}`);

// ── 名冊：頁 id → 座號 ───────────────────────────────────────────
const roster = (await queryAll(DS.roster))
  .filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: p.properties?.["座號"]?.number }))
  .filter(r => Number.isFinite(r.seat));
const seatOf = new Map(roster.map(r => [r.id, r.seat]));
console.log(`👥 在學名冊 ${roster.length} 人`);

// ── 帳本：現有餘額（扣至歸零要用）與已入帳鍵 ────────────────────
const bank = await queryAll(DS.bank);
const balance = new Map(roster.map(r => [r.seat, 0]));
const booked = new Set();
for (const b of bank) {
  const amt = b.properties?.["金額"]?.number ?? 0;
  for (const sid of relIds(b, "學生")) {
    const seat = seatOf.get(sid);
    if (seat === undefined) continue;
    balance.set(seat, (balance.get(seat) ?? 0) + amt);
    for (const lid of relIds(b, "紀錄庫")) booked.add(`${lid}|${sid}`);
  }
}
console.log(`🏦 帳本 ${bank.length} 列｜已入帳鍵 ${booked.size} 組`);

// ── 紀錄庫：該週、金幣影響≠0 ────────────────────────────────────
const logs = (await queryAll(DS.log))
  .map(p => ({
    id: p.id,
    date: p.properties?.["日期"]?.date?.start ?? "",
    coin: p.properties?.["金幣影響"]?.number ?? 0,
    desc: (p.properties?.["事件描述"]?.title ?? []).map(t => t.plain_text).join(""),
    week: (p.properties?.["週次"]?.rich_text ?? []).map(t => t.plain_text).join(""),
    students: relIds(p, "學生"),
  }))
  .filter(r => r.week === WEEK && r.coin !== 0)
  .sort((a, b) => a.date.localeCompare(b.date));
console.log(`📝 ${WEEK} 金幣影響≠0 的紀錄 ${logs.length} 列（展開前）`);

// ── 逐筆展開成帳列 ──────────────────────────────────────────────
const creates = [];
let skipDup = 0, skipOff = 0, skipNoDate = 0, zeroed = 0;
for (const g of logs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) { skipNoDate += g.students.length; continue; } // 日期是學年／週次的依據，空的不猜
  for (const sid of g.students) {
    const seat = seatOf.get(sid);
    if (seat === undefined) { skipOff++; continue; }        // 非在學（轉出／模擬列）
    if (booked.has(`${g.id}|${sid}`)) { skipDup++; continue; }
    let amt = Math.round(g.coin);
    let desc = g.desc;
    if (amt < 0) {
      const bal = balance.get(seat) ?? 0;
      if (-amt > bal) { amt = -bal; desc += "(扣至歸零)"; zeroed++; }
      if (amt === 0) continue;
    }
    balance.set(seat, (balance.get(seat) ?? 0) + amt);
    creates.push({
      seat, amt, logId: g.id, stuId: sid,
      props: {
        "事由": { title: rt(desc) },
        "日期": { date: { start: g.date } },
        "週次": { rich_text: rt(WEEK) },
        "學年": { select: { name: yearOf(g.date) } },        // 學年鐵則：由該筆日期算，不是今天
        "學生": { relation: [{ id: sid }] },
        "類型": { select: { name: amt > 0 ? "獎勵金" : "懲罰金" } },
        "金額": { number: amt },
        "紀錄庫": { relation: [{ id: g.id }] },               // 防重複鍵的另一半，必填
      },
    });
  }
}

const bySeat = new Map();
for (const c of creates) bySeat.set(c.seat, (bySeat.get(c.seat) ?? 0) + c.amt);
const sum = creates.reduce((n, c) => n + c.amt, 0);
console.log(`\n📊 待入帳 ${creates.length} 筆／${sum} 幣｜已入帳略過 ${skipDup} 筆｜非在學略過 ${skipOff} 筆｜無日期略過 ${skipNoDate} 筆｜扣至歸零 ${zeroed} 筆`);
console.log(`   明細：${[...bySeat.entries()].sort((a, b) => a[0] - b[0]).map(([s, v]) => `座號${s} ${v >= 0 ? "+" : ""}${v}`).join("、") || "（無）"}`);

if (!creates.length) { console.log("\n✅ 沒有要補的，結束。"); process.exit(0); }
if (!isExecute()) { console.log("\n🔍 dry-run：未寫入任何資料（要寫請用 mode=execute）"); process.exit(0); }

// ── 寫入 ───────────────────────────────────────────────────────
let ok = 0, fail = 0;
await forEachThrottled(creates, async c => {
  const res = await api("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: DS.bank },
    properties: c.props,
  });
  // ⚠️ lib 的 api() 回的是 { status, ok, json }，**不是** Notion 頁物件本身——
  // 第一版寫 `res?.id` 判成功，於是 53 筆真的寫進去了卻全報「寫入失敗」（2026-09-12 踩到）。
  // 回讀那一關救了這次：它看的是帳本實際筆數與防重複鍵，不是這裡的計數。
  if (res.ok && res.json?.id) ok++;
  else { fail++; console.error(`   ❌ 座號${c.seat} ${c.amt} 幣寫入失敗（HTTP ${res.status} ${res.json?.code ?? ""}）`); }
});
console.log(`\n✍️ 寫入完成：成功 ${ok} 筆／失敗 ${fail} 筆`);

// ── 回讀驗收（不是「沒噴錯」就算數）────────────────────────────
const bank2 = await queryAll(DS.bank);
const booked2 = new Set();
for (const b of bank2) {
  for (const sid of relIds(b, "學生")) for (const lid of relIds(b, "紀錄庫")) booked2.add(`${lid}|${sid}`);
}
const missing = creates.filter(c => !booked2.has(`${c.logId}|${c.stuId}`));
const added = bank2.length - bank.length;
console.log(`🔁 回讀：帳本 ${bank.length} → ${bank2.length}（＋${added}）｜應有的防重複鍵缺 ${missing.length} 組`);
console.log(missing.length || fail || added !== ok
  ? "❌ 驗收未通過，請人工檢查（不要重跑，先看帳本）"
  : "✅ 驗收通過：筆數與防重複鍵都對得上；再跑一次本任務應該是 0 筆");
