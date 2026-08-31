/**
 * f23｜第一週週結補結：把 8/28（返校日）與 8/31（開學日）的獎懲紀錄入帳
 * ───────────────────────────────────────────────────────────────
 * 背景（老師 2026-08-31 裁示）：紀錄庫累積 200+ 筆「金幣影響 ≠ 0」卻從未週結，
 *       學生存摺只看得到 8/07 返校日那批（已入帳），其餘全部懸空。
 *       老師裁示：8/28 返校日與 8/31 開學日的紀錄一律歸入「四上第1週(8/31-9/4)」。
 *
 * 只做週結的第二步（結算獎懲）。薪水與工作薪水本週五才發，本腳本不碰。
 *
 * 冪等：以（紀錄庫頁 id × 學生頁 id）為鍵比對帳本既有列，已入帳者跳過。
 *       ⚠️ 一筆紀錄可掛多位學生（共同表現），每位各建一筆帳，
 *          所以防重複的鍵**不能只用紀錄 id**，否則第二位以後會被誤判為已入帳。
 *
 * 扣至歸零（class-bank 硬性規則 3）：懲罰金絕對值 > 當下餘額時只記 −餘額，
 *       事由末尾註「(扣至歸零)」。餘額依日期序逐筆累計，起算值＝帳本現有餘額。
 *
 * 同時把來源紀錄的「週次」正規化成同一個字串（原本空白或誤填「本週」）。
 *
 * 用法：GitHub Actions → ClassOS Phase F 工具 → task=f23-settle-week1
 *       mode=dry-run（預設，只列不寫）／execute（實際入帳）
 *
 * ⚠️ 本 repo 為 PUBLIC，Actions log 公開可讀——只印座號與金額，不印姓名與事件描述。
 */
import { queryAll, api, updatePage, isExecute, DS, forEachThrottled } from "./lib/notion.mjs";

const WEEK = "四上第1週(8/31-9/4)";
const YEAR = "115";
const FROM_DATE = "2026-08-28";   // 含當日起；8/07 那批已入帳，不重結

const rt = s => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];
const relIds = (page, name) => (page.properties?.[name]?.relation ?? []).map(r => r.id);

// ── 名冊：頁 id → 座號 ───────────────────────────────────────────
const roster = (await queryAll(DS.roster))
  .filter(p => p.properties?.["在學"]?.checkbox)
  .map(p => ({ id: p.id, seat: p.properties?.["座號"]?.number }))
  .filter(r => Number.isFinite(r.seat));
const seatOf = new Map(roster.map(r => [r.id, r.seat]));
console.log(`👥 在學名冊 ${roster.length} 人`);

// ── 帳本：現有餘額與已入帳鍵 ────────────────────────────────────
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
console.log(`🏦 帳本現有 ${bank.length} 列，已入帳鍵 ${booked.size} 組`);

// ── 紀錄庫：待結的獎懲 ──────────────────────────────────────────
const logs = (await queryAll(DS.log))
  .map(p => ({
    id: p.id,
    date: p.properties?.["日期"]?.date?.start ?? "",
    coin: p.properties?.["金幣影響"]?.number ?? 0,
    desc: (p.properties?.["事件描述"]?.title ?? []).map(t => t.plain_text).join(""),
    week: (p.properties?.["週次"]?.rich_text ?? []).map(t => t.plain_text).join(""),
    students: relIds(p, "學生"),
  }))
  .filter(r => r.coin !== 0 && r.date >= FROM_DATE)
  .sort((a, b) => a.date.localeCompare(b.date));
console.log(`📝 ${FROM_DATE} 起金幣影響≠0 的紀錄 ${logs.length} 筆`);

// ── 逐筆展開成帳列 ──────────────────────────────────────────────
const creates = [];
let skipDup = 0, skipOff = 0, zeroed = 0;
for (const g of logs) {
  for (const sid of g.students) {
    const seat = seatOf.get(sid);
    if (seat === undefined) { skipOff++; continue; }          // 非在學名冊（模擬學生／已轉出）
    if (booked.has(`${g.id}|${sid}`)) { skipDup++; continue; }
    let amt = Math.round(g.coin);
    let desc = g.desc;
    if (amt < 0) {
      const bal = balance.get(seat) ?? 0;
      if (-amt > bal) { amt = -bal; desc += "(扣至歸零)"; zeroed++; }
      if (amt === 0) continue;                                 // 已經 0 幣，不建空帳
    }
    balance.set(seat, (balance.get(seat) ?? 0) + amt);
    creates.push({
      seat, amt, date: g.date, logId: g.id, stuId: sid,
      props: {
        "事由": { title: rt(desc) },
        "日期": { date: { start: g.date } },
        "週次": { rich_text: rt(WEEK) },
        "學生": { relation: [{ id: sid }] },
        "類型": { select: { name: amt > 0 ? "獎勵金" : "懲罰金" } },
        "金額": { number: amt },
        "紀錄庫": { relation: [{ id: g.id }] },
        "學年": { select: { name: YEAR } },
      },
    });
  }
}

// ── 來源紀錄的週次正規化（空白或「本週」→ 正式週次字串）──────────
const weekFix = logs.filter(g => g.week !== WEEK).map(g => ({ id: g.id, date: g.date }));

const bySeat = new Map();
for (const c of creates) {
  const s = bySeat.get(c.seat) ?? { n: 0, sum: 0 };
  s.n++; s.sum += c.amt; bySeat.set(c.seat, s);
}
console.log(`\n── 逐生入帳（座號\\筆數\\金額\\結後餘額）──`);
for (const seat of [...bySeat.keys()].sort((a, b) => a - b)) {
  const s = bySeat.get(seat);
  console.log(`${seat}\t${s.n}\t${s.sum > 0 ? "+" : ""}${s.sum}\t${balance.get(seat)}`);
}
console.log(`\n📊 待建帳列 ${creates.length}（涵蓋 ${bySeat.size} 人，合計 ${[...bySeat.values()].reduce((a, b) => a + b.sum, 0)} 幣）`);
console.log(`   已入帳跳過 ${skipDup}　非在學跳過 ${skipOff}　扣至歸零 ${zeroed}`);
console.log(`📝 待正規化週次的紀錄 ${weekFix.length} 筆 → 「${WEEK}」`);

if (!isExecute()) {
  console.log("\n🔍 dry-run：未寫入任何資料。確認上表無誤後改 mode=execute 重跑。");
  process.exit(0);
}

const mk = c => api("POST", "/pages", { parent: { type: "data_source_id", data_source_id: DS.bank }, properties: c.props });
const r1 = await forEachThrottled(creates, mk);
console.log(`\n✅ 入帳成功 ${r1.ok.length} 列，失敗 ${r1.fail.length} 列`);
for (const f of r1.fail) console.error(`  ❌ 座號 ${f.item?.seat}：${f.error || JSON.stringify(f.r?.json?.message)}`);

const r2 = await forEachThrottled(weekFix, w => updatePage(w.id, { "週次": { rich_text: rt(WEEK) } }));
console.log(`✅ 週次正規化 ${r2.ok.length} 筆，失敗 ${r2.fail.length} 筆`);
for (const f of r2.fail) console.error(`  ❌ ${f.item?.date}：${f.error || JSON.stringify(f.r?.json?.message)}`);

if (r1.fail.length || r2.fail.length) process.exit(1);
